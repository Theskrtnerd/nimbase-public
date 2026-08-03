import type { NodeSourceRef } from "@acme/db/node-metadata";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { loadNodeSources, loadNodeTags } from "@acme/db/node-metadata";
import { WikiNode, WikiNodeVersion } from "@acme/db/schema";

import type { KbGraphNode } from "../knowledge-graph";
import type { ProviderAccessContext } from "./context";
import type { MemoryNode, SourceRef } from "./node";
import type {
  Capability,
  MemoryLink,
  MemoryProvider,
  MemorySearchQuery,
  MemorySearchResult,
  MemoryUpsertInput,
  NeighborsOptions,
  ReconcileAction,
  ReconcileCandidate,
  ReconcileOptions,
  ReconcileResult,
} from "./provider";
import type { GardenerOp } from "./wiki";
import { resolveModels } from "../ai";
import { COMPANY_MD_PATH } from "../biographer";
import { scanReadableGraphInputs, scopeWhere } from "../graph-scan";
import { harnessEnabledFor, runGardenerHarness } from "../harness";
import { buildKnowledgeGraph } from "../knowledge-graph";
import * as s3 from "../s3";
import { searchWorkspace } from "../search";
import { parseOkf, serializeOkf } from "./okf/codec";
import { assertOpToolset, CapabilityNotSupportedError } from "./provider";
import { GardenerFs, normalizeTitle, runGardener, WikiReadFs } from "./wiki";

// Re-exported so the shared scope-filter helper stays reachable from the
// provider's public surface (and its unit tests) even though it now lives in
// graph-scan alongside the shared graph scan.
export { scopeWhere } from "../graph-scan";

// Map @acme/db provenance rows onto the contract's SourceRef. The wiki store
// tracks a source by its capture URL when it has one, falling back to a stable
// internal id ref for URL-less captures (voice/screenshot). checksum/version/
// span are not tracked at whole-note grain. Exported for unit tests.
export function toSourceRefs(rows: NodeSourceRef[]): SourceRef[] {
  return rows.map((row) => ({
    uri: row.sourceUrl ?? `nimbase:source/${row.id}`,
  }));
}

// Assemble a MemoryNode DTO from a wiki row + its S3 body + metadata. The DTO
// id is the WikiNode uuid (1:1 whole-note grain). `summary`/`updatedAt` are
// typed optional contract fields, set only when present so the lean nodes
// `search`/`neighbors` return stay minimal. `sources` defaults to `[]` — rich
// provenance is `provenance()`'s job (see the node.ts contract). Exported for
// unit tests.
export function assembleMemoryNode(args: {
  id: string;
  path: string;
  title: string;
  body: string;
  tags: string[];
  kind?: "note" | "folder" | "dataset";
  type?: string;
  sources?: SourceRef[];
  summary?: string | null;
  updatedAt?: Date | null;
}): MemoryNode {
  const node: MemoryNode = {
    id: args.id,
    // Kind comes from the wiki_node row when the caller has it (fetch);
    // lean search/graph nodes default to "note". Folders never appear in
    // the contract, so they collapse to "note" defensively.
    kind: args.kind === "dataset" ? "dataset" : "note",
    title: args.title,
    content: args.body,
    metadata: { path: args.path },
    labels: args.tags,
    sources: args.sources ?? [],
  };
  if (args.type != null) node.type = args.type;
  if (args.summary != null) node.summary = args.summary;
  if (args.updatedAt != null) node.updatedAt = args.updatedAt;
  return node;
}

// Collapse the gardener's recorded VFS mutations into one typed reconcile
// outcome. This is a HEURISTIC over a possibly-multi-op run:
//   - a delete that co-occurs with a write → `supersede` (content moved into a
//     surviving write; `nodeId` = that survivor, `supersededIds` = retired ids)
//   - otherwise classify by the writes alone: any create → `insert`; else any
//     in-place update → `merge`; else `noop`
//   - deletes WITHOUT a surviving write are housekeeping (redundant notes
//     removed), NOT a supersede: they surface in `deletedIds` and don't change
//     the action.
// Metadata-only ops (tags/title/citations) and pure renames don't change what
// knowledge exists, so they never appear in `ops` and can't drive the action.
// Exported for unit tests.
export function deriveReconcileAction(ops: readonly GardenerOp[]): {
  action: ReconcileAction;
  nodeId?: string;
  supersededIds?: string[];
  deletedIds?: string[];
} {
  const writes = ops.filter(
    (o): o is Extract<GardenerOp, { op: "create" | "update" }> =>
      o.op === "create" || o.op === "update",
  );
  const deletedIds = ops
    .filter(
      (o): o is Extract<GardenerOp, { op: "delete" }> => o.op === "delete",
    )
    .flatMap((o) => o.nodeIds);

  // Supersede requires a survivor: a delete alongside a create/update the
  // content landed in.
  const survivor = writes[0];
  if (deletedIds.length > 0 && survivor) {
    return {
      action: "supersede",
      nodeId: survivor.nodeId,
      supersededIds: deletedIds,
    };
  }

  // No supersede. Any leftover deletes are housekeeping — report them, but let
  // the writes (if any) decide the action.
  const housekeeping = deletedIds.length > 0 ? { deletedIds } : {};
  const created = writes.find((o) => o.op === "create");
  if (created) return { action: "insert", nodeId: created.nodeId };
  const updated = writes.find((o) => o.op === "update");
  if (updated) return { action: "merge", nodeId: updated.nodeId };
  return { action: "noop", ...housekeeping };
}

interface ReadableNodeRow {
  id: string;
  path: string;
  kind: "note" | "folder" | "dataset";
  title: string;
  currentVersionId: string | null;
  updatedAt: Date | null;
}

// The wiki/Postgres MemoryProvider — the single backing implementation today.
// It deliberately fuses the LLM-navigated folder tree (WikiNode +
// WikiNodeVersion bodies in S3) with vector + full-text retrieval. Reads apply
// path scopes SQL-side; writes (`upsert` direct, `reconcile` via the gardener)
// are fenced by the VFS. `link` stays off — no edge table (NOT-61). Every op
// asserts its toolset against the branded context.
export class WikiPgProvider implements MemoryProvider {
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "search",
    "fetch",
    "neighbors",
    "provenance",
    "upsert",
    "reconcile",
  ]);

  async search(
    ctx: ProviderAccessContext,
    query: MemorySearchQuery,
  ): Promise<MemorySearchResult[]> {
    assertOpToolset(ctx, "search");
    // kinds is reserved for a finer future grain; today every node is a note,
    // so the filter is a no-op and search wraps the existing RRF fusion as-is.
    const hits = await searchWorkspace({
      workspaceId: ctx.workspaceId,
      query: query.text,
      limit: query.limit,
      scopes: ctx.scopes.read ?? undefined,
    });
    // Content is the best-matching snippet the search leg already surfaces —
    // the wrap adds no per-hit S3 fetch, preserving current search behavior.
    return hits.map((hit) => ({
      node: assembleMemoryNode({
        id: hit.nodeId,
        path: hit.path,
        title: hit.title,
        body: hit.snippet,
        tags: [],
        sources: [],
      }),
      score: hit.score,
    }));
  }

  async fetch(
    ctx: ProviderAccessContext,
    id: string,
  ): Promise<MemoryNode | null> {
    assertOpToolset(ctx, "fetch");
    const node = await this.loadReadableNodeRow(ctx, id);
    // null for both "doesn't exist" and "not readable" — invisible notes must
    // not reveal their existence.
    if (!node?.currentVersionId) return null;

    const [version] = await db
      .select({
        s3Key: WikiNodeVersion.s3Key,
        summary: WikiNodeVersion.summary,
      })
      .from(WikiNodeVersion)
      .where(eq(WikiNodeVersion.id, node.currentVersionId))
      .limit(1);
    if (!version) return null;

    // No source loading here: `fetch` leaves `sources` empty by contract — a
    // caller wanting provenance calls `provenance(id)`. This keeps note reads
    // to exactly one source query, done by the caller when it needs the rich
    // shape.
    const [body, tags] = await Promise.all([
      s3.getObjectText(version.s3Key),
      loadNodeTags(node.id),
    ]);

    return assembleMemoryNode({
      id: node.id,
      path: node.path,
      title: node.title,
      body,
      tags,
      kind: node.kind,
      type: parseOkf(body).meta.type,
      summary: version.summary,
      updatedAt: node.updatedAt,
    });
  }

  async neighbors(
    ctx: ProviderAccessContext,
    id: string,
    options?: NeighborsOptions,
  ): Promise<MemoryNode[]> {
    assertOpToolset(ctx, "neighbors");
    // Must be visible to the caller first — otherwise return no neighbors
    // rather than leak that the node exists.
    const target = await this.loadReadableNodeRow(ctx, id);
    if (!target?.currentVersionId) return [];

    // Same scan as the tRPC kb.graph procedure (shared via scanReadableGraphInputs):
    // readable compiled notes, their S3 bodies parsed for [[wikilinks]]. Path
    // scope is applied SQL-side, so hidden notes never enter the graph and
    // ghost-suppression (kb.graph's hiddenPaths) is unnecessary here —
    // dropped/ghosted links are non-real nodes and excluded from the neighbor
    // result regardless.
    const { inputs } = await scanReadableGraphInputs(
      ctx.workspaceId,
      ctx.scopes.read,
    );
    const { nodes, links } = buildKnowledgeGraph(inputs);

    const targetGraphNode = nodes.find((n) => n.nodeId === id);
    if (!targetGraphNode) return [];

    const neighborGraphIds = new Set<string>();
    for (const link of links) {
      if (link.source === targetGraphNode.id) neighborGraphIds.add(link.target);
      else if (link.target === targetGraphNode.id)
        neighborGraphIds.add(link.source);
    }

    const realByGraphId = new Map<string, KbGraphNode>();
    for (const n of nodes) {
      if (n.nodeId) realByGraphId.set(n.id, n);
    }
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));

    const out: MemoryNode[] = [];
    for (const graphId of neighborGraphIds) {
      const graphNode = realByGraphId.get(graphId);
      // Skip ghost neighbors (unresolved links have no backing node).
      if (!graphNode?.nodeId) continue;
      const row = inputByNodeId.get(graphNode.nodeId);
      if (!row) continue;
      out.push(
        assembleMemoryNode({
          id: graphNode.nodeId,
          path: row.path,
          title: row.title,
          body: row.body,
          tags: graphNode.tags,
          sources: [],
        }),
      );
      if (options?.limit != null && out.length >= options.limit) break;
    }
    return out;
  }

  async provenance(
    ctx: ProviderAccessContext,
    id: string,
  ): Promise<SourceRef[]> {
    assertOpToolset(ctx, "provenance");
    // Gate on visibility first: provenance of an invisible node is empty so it
    // never reveals the node's existence.
    const node = await this.loadReadableNodeRow(ctx, id);
    if (!node) return [];
    const sources = await loadNodeSources(node.id);
    return toSourceRefs(sources);
  }

  // Direct versioned write at an explicit path — the deterministic write door
  // (own-note flows, eval fixture seeding), distinct from the gardener-mediated
  // `reconcile`. Goes through the same append-only GardenerFs.write
  // machinery, so it reindexes chunks and bumps a version exactly like a
  // compile. The FS is fenced to the caller's capture scopes, so the write can
  // only land where they may capture; the toolset gate is asserted here.
  async upsert(
    ctx: ProviderAccessContext,
    input: MemoryUpsertInput,
  ): Promise<MemoryNode> {
    assertOpToolset(ctx, "upsert");

    if (!input.path) {
      throw new Error("upsert requires an explicit metadata path (input.path)");
    }

    // No originating capture: a direct upsert has no Source to stamp/cite.
    const fs = GardenerFs.forScopes(
      ctx.workspaceId,
      null,
      null,
      ctx.scopes.capture,
    );
    const summary = input.summary ?? input.title;

    // write() derives the concept's title from the body frontmatter, so fold
    // the contract's separate title field into the frontmatter before
    // persisting. A caller-declared OKF type ("Dataset", "Company Profile",
    // ...) is stamped the same way; kind: "dataset" implies type: Dataset.
    const title = normalizeTitle(input.title);
    if (!title) throw new Error("upsert requires a non-empty title");
    const parsed = parseOkf(input.content);
    parsed.meta.title = title;
    const okfType = input.type ?? (input.kind === "dataset" ? "Dataset" : null);
    if (okfType) parsed.meta.type = okfType;
    await fs.write(
      input.path,
      serializeOkf(parsed.meta, parsed.content),
      summary,
    );

    const node = await this.loadNodeByPath(ctx.workspaceId, input.path);
    if (!node) throw new Error(`upsert wrote "${input.path}" but it vanished`);
    return node;
  }

  link(_ctx: ProviderAccessContext, _edge: MemoryLink): Promise<void> {
    throw new CapabilityNotSupportedError("link");
  }

  // The conflict-resolution front door: run the gardener (an LLM agent over the
  // fenced VFS) against the candidate source, then TYPE what it did. The
  // gardener already merges/dedups/reorganizes; this wrapper only derives a
  // typed ReconcileResult from the mutations it recorded (see
  // deriveReconcileAction) — it does not steer the agentic loop.
  async reconcile(
    ctx: ProviderAccessContext,
    candidate: ReconcileCandidate,
    options: ReconcileOptions,
  ): Promise<ReconcileResult> {
    assertOpToolset(ctx, "reconcile");

    // Standing company context (company.md, written by the Biographer) — the
    // workspace's own overview, injected into every compile so the gardener
    // interprets sources knowing whose memory it is tending. Best-effort: a
    // workspace without one compiles exactly as before.
    const companyContext = await new WikiReadFs(ctx.workspaceId, null)
      .read(COMPANY_MD_PATH)
      .then((body) => body.slice(0, 4_000))
      .catch(() => null);

    const gardenerArgs = {
      workspaceId: ctx.workspaceId,
      sourceId: options.sourceId,
      jobId: options.jobId,
      sourceKind: candidate.sourceKind,
      sourceTitle: candidate.title ?? null,
      rawText: candidate.content,
      fence: options.fence,
      companyContext,
    };

    // Flagged runner: the Pi-harness gardener (wiki mounted as the sandbox
    // filesystem) vs the legacy generateText loop. Same GardenerResult
    // contract either way, so the reconcile derivation below is shared.
    if (harnessEnabledFor("gardener")) {
      const { report, usage, ops } = await runGardenerHarness(gardenerArgs);
      return { ...deriveReconcileAction(ops), report, usage };
    }

    // The provider owns model selection (per-workspace AI config → global →
    // defaults); callers never pass a model string.
    const { chat } = await resolveModels(ctx.workspaceId);

    const { report, usage, ops } = await runGardener({
      ...gardenerArgs,
      chatModel: chat.model,
      chatModelId: chat.id,
    });

    return { ...deriveReconcileAction(ops), report, usage };
  }

  // Load + assemble a node by its path within a workspace, WITHOUT read-scope
  // gating (the write that produced it already passed the capture-scope fence).
  // Returns null if the path has no live current version.
  private async loadNodeByPath(
    workspaceId: string,
    path: string,
  ): Promise<MemoryNode | null> {
    const [node] = await db
      .select({
        id: WikiNode.id,
        path: WikiNode.path,
        kind: WikiNode.kind,
        title: WikiNode.title,
        currentVersionId: WikiNode.currentVersionId,
      })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.workspaceId, workspaceId),
          eq(WikiNode.path, path),
          isNull(WikiNode.deletedAt),
        ),
      )
      .limit(1);
    if (!node?.currentVersionId) return null;

    const [version] = await db
      .select({
        s3Key: WikiNodeVersion.s3Key,
        summary: WikiNodeVersion.summary,
      })
      .from(WikiNodeVersion)
      .where(eq(WikiNodeVersion.id, node.currentVersionId))
      .limit(1);
    if (!version) return null;

    const [body, sources, tags] = await Promise.all([
      s3.getObjectText(version.s3Key),
      loadNodeSources(node.id),
      loadNodeTags(node.id),
    ]);

    return assembleMemoryNode({
      id: node.id,
      path: node.path,
      title: node.title,
      body,
      tags,
      kind: node.kind,
      type: parseOkf(body).meta.type,
      sources: toSourceRefs(sources),
      summary: version.summary,
    });
  }

  // Load one node row scoped to the caller's read paths (SQL-side) within the
  // context's workspace, or null when it doesn't exist / isn't readable.
  private async loadReadableNodeRow(
    ctx: ProviderAccessContext,
    id: string,
  ): Promise<ReadableNodeRow | null> {
    const [row] = await db
      .select({
        id: WikiNode.id,
        path: WikiNode.path,
        kind: WikiNode.kind,
        title: WikiNode.title,
        currentVersionId: WikiNode.currentVersionId,
        updatedAt: WikiNode.updatedAt,
      })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.id, id),
          eq(WikiNode.workspaceId, ctx.workspaceId),
          isNull(WikiNode.deletedAt),
          scopeWhere(WikiNode.path, ctx.scopes.read),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

// The process-wide MemoryProvider instance. WikiPgProvider is stateless (it
// holds only its capability set), so one shared instance is safe and every
// knowledge-access caller — the compile worker, MCP tools, the tRPC kb router,
// the REST cores the CLI hits — imports THIS rather than newing its own, so
// there is exactly one backing memory provider (NOT-59).
export const memoryProvider: MemoryProvider = new WikiPgProvider();
