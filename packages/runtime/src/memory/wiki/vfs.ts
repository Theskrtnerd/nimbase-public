import "server-only";

import { randomUUID } from "node:crypto";

import type { PathScope } from "@acme/db";
import type { NodeSourceRef } from "@acme/db/node-metadata";
import type { MemoryMutationChange } from "@acme/db/schema";
import { and, eq, inArray, isNull, sql } from "@acme/db";
import { pathInScopes } from "@acme/db/access-core";
import { db } from "@acme/db/client";
import { loadNodeSources } from "@acme/db/node-metadata";
import {
  AccessGrant,
  MemoryMutation,
  Source,
  WikiNode,
  WikiNodeSource,
  WikiNodeTag,
  WikiNodeVersion,
  Workspace,
} from "@acme/db/schema";

import type { ParsedOkf } from "../okf/codec";
import { indexNodeVersion } from "../../index-node-version";
import * as s3 from "../../s3";
import { notifyMemoryGitProjection } from "../git-dispatch";
import {
  parseOkf,
  projectToDb,
  serializeOkf,
  sourceUriFor,
  stampServerFields,
} from "../okf/codec";
import { normalizeTags, normalizeTitle } from "../okf/normalize";
import { kindForType } from "../okf/schema";
import { kebabSegmentError, noteLeafError } from "./path";

// Expected, model-recoverable failure (bad path, pinned node, ambiguous edit).
// The gardener's tools catch this and hand the message back to the model;
// anything else propagates and fails the compile job.
export class VfsError extends Error {}

// Content-mutating ops a GardenerFs run performed, recorded so the caller can
// derive a typed outcome from what actually happened (see
// WikiPgProvider.reconcile / deriveReconcileAction). Only writes and deletes
// are recorded — metadata-only ops (set_tags/set_title/cite_sources) and pure
// reorganization (mv) don't change what knowledge exists, so they don't factor
// into the reconcile action. This is instrumentation of the FS; the gardener's
// agentic loop and its VFS tools are untouched.
export interface GardenerWriteOp {
  op: "create" | "update";
  kind: "note" | "dataset";
  path: string;
  nodeId: string;
}

export interface GardenerDeleteOp {
  op: "delete";
  path: string;
  nodeIds: string[];
}

export type GardenerOp = GardenerWriteOp | GardenerDeleteOp;

interface NodeRow {
  id: string;
  path: string;
  kind: "note" | "folder" | "dataset";
  title: string;
  pinned: boolean;
  restricted: boolean;
  currentVersionId: string | null;
  summary: string | null;
  s3Key: string | null;
}

interface WriteVersionInput {
  nodeId: string;
  path: string;
  parsed: ParsedOkf;
  summary: string;
  currentTitle: string;
  mutationMessage: string;
  newNode?: {
    path: string;
    kind: "note" | "dataset";
    title: string;
  };
}

// One fence-visible live node, as exposed to the harness filesystem adapter.
export interface WikiEntry {
  path: string;
  kind: "note" | "folder" | "dataset";
  title: string;
  pinned: boolean;
  hasBody: boolean;
}

const GREP_MAX_MATCHES = 100;

// Everything but a path's leaf segment, joined back with "/" — kebab-case
// validation applies to folder-prefix segments, which never carry a .md
// suffix (that's the leaf's job, checked separately via noteLeafError).
function folderPrefixOf(path: string): string {
  return path.split("/").filter(Boolean).slice(0, -1).join("/");
}

// Read-only filesystem view over the workspace wiki, fenced to a set of path
// scopes. null fences = unrestricted (admin). Shared by the gardener (which
// adds write tools) and the artifact generator (read-only).
export class WikiReadFs {
  protected readonly bodyCache = new Map<string, string>();

  constructor(
    protected readonly workspaceId: string,
    // null = no boundary (admin / unrestricted).
    protected readonly fences: PathScope[] | null,
  ) {}

  protected inFence(path: string): boolean {
    return this.fences === null || pathInScopes(this.fences, path);
  }

  // Live (non-deleted) nodes with their current version's summary and s3Key,
  // filtered through the fence so out-of-scope nodes are invisible.
  protected async listNodes(): Promise<NodeRow[]> {
    const rows = await db
      .select({
        id: WikiNode.id,
        path: WikiNode.path,
        kind: WikiNode.kind,
        title: WikiNode.title,
        pinned: WikiNode.pinned,
        restricted: WikiNode.restricted,
        currentVersionId: WikiNode.currentVersionId,
        summary: WikiNodeVersion.summary,
        s3Key: WikiNodeVersion.s3Key,
      })
      .from(WikiNode)
      .leftJoin(
        WikiNodeVersion,
        eq(WikiNodeVersion.id, WikiNode.currentVersionId),
      )
      .where(
        and(
          eq(WikiNode.workspaceId, this.workspaceId),
          isNull(WikiNode.deletedAt),
        ),
      );
    return this.fences === null
      ? rows
      : rows.filter((n) => this.inFence(n.path));
  }

  protected async getNodeByPath(path: string): Promise<NodeRow | undefined> {
    return (await this.listNodes()).find((n) => n.path === path);
  }

  async tree(): Promise<string> {
    const nodes = await this.listNodes();
    if (nodes.length === 0) return "(empty wiki — no notes yet)";
    return nodes
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(
        (n) =>
          `${n.path}${n.pinned ? " [pinned]" : ""}${n.summary ? ` — ${n.summary}` : ""}`,
      )
      .join("\n");
  }

  async read(path: string): Promise<string> {
    const cached = this.bodyCache.get(path);
    if (cached !== undefined) return cached;

    const node = await this.getNodeByPath(path);
    if (!node?.currentVersionId || !node.s3Key) {
      throw new VfsError(`no note at "${path}" — use tree to list paths`);
    }
    const body = await s3.getObjectText(node.s3Key);
    this.bodyCache.set(path, body);
    return body;
  }

  // Public, fence-filtered view of the live node rows. Backs the harness
  // filesystem adapter (WikiFileSystem), which needs raw paths/kinds rather
  // than the model-facing tree() rendering.
  async listEntries(): Promise<WikiEntry[]> {
    const nodes = await this.listNodes();
    return nodes.map((n) => ({
      path: n.path,
      kind: n.kind,
      title: n.title,
      pinned: n.pinned,
      hasBody: n.currentVersionId != null,
    }));
  }

  async grep(pattern: string, ignoreCase = false): Promise<string> {
    let re: RegExp;
    try {
      re = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch (err) {
      throw new VfsError(
        `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const notes = (await this.listNodes()).filter((n) => n.currentVersionId);
    const out: string[] = [];
    for (const note of notes) {
      if (out.length >= GREP_MAX_MATCHES) break;
      const body = await this.read(note.path);
      const lines = body.split("\n");
      for (let i = 0; i < lines.length && out.length < GREP_MAX_MATCHES; i++) {
        const line = lines[i] ?? "";
        if (re.test(line)) out.push(`${note.path}:${i + 1}: ${line.trim()}`);
      }
    }
    if (out.length === 0) return "no matches";
    const capped =
      out.length >= GREP_MAX_MATCHES
        ? `\n(capped at ${GREP_MAX_MATCHES} matches)`
        : "";
    return out.join("\n") + capped;
  }

  // Tags used across the in-fence wiki, with note counts. Joins the derived
  // wiki_node_tag index to live nodes and filters through the fence so tag
  // names never leak the existence of out-of-scope notes. Backs the gardener's
  // list_tags registry tool.
  async listTags(): Promise<{ tag: string; count: number }[]> {
    const rows = await db
      .select({ tag: WikiNodeTag.tag, path: WikiNode.path })
      .from(WikiNodeTag)
      .innerJoin(WikiNode, eq(WikiNode.id, WikiNodeTag.nodeId))
      .where(
        and(
          eq(WikiNodeTag.workspaceId, this.workspaceId),
          isNull(WikiNode.deletedAt),
        ),
      );
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!this.inFence(r.path)) continue;
      counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // Sources (captures) attributed to a note — its own compile history plus
  // anything explicitly cited onto it. Fence-checked the same way read() is,
  // via getNodeByPath. Backs the gardener's list_citations tool: read a note's
  // sources before citing them onto a merge target with cite_sources.
  async listSources(path: string): Promise<NodeSourceRef[]> {
    const node = await this.getNodeByPath(path);
    if (!node) {
      throw new VfsError(`no note at "${path}" — use tree to list paths`);
    }
    return loadNodeSources(node.id);
  }
}

// Adds write capability on top of the read base. Fenced to a scope LIST (or
// null = unrestricted), matching WikiReadFs — a compile passes its single
// target scope as a one-element list; a direct upsert passes the caller's
// capture scopes.
export class GardenerFs extends WikiReadFs {
  // Content mutations this run performed, in order (see GardenerOp). Read via
  // ops() after the run to derive a typed reconcile outcome.
  private readonly recordedOps: GardenerOp[] = [];

  constructor(
    workspaceId: string,
    // null for a direct write with no originating capture (e.g. an admin
    // upsert or eval seeding): the version's sourceId stays null and nothing
    // is auto-cited.
    private readonly sourceId: string | null,
    private readonly jobId: string | null,
    fences: PathScope[] | null,
  ) {
    super(workspaceId, fences);
  }

  // Direct-write entry for upsert: fences to a caller's capture scope LIST
  // (or null = unrestricted). The VFS enforces these scopes on every write via
  // inFence, exactly as the compile fence does. No originating capture/job, so
  // writes carry no sourceId.
  static forScopes(
    workspaceId: string,
    sourceId: string | null,
    jobId: string | null,
    scopes: PathScope[] | null,
  ): GardenerFs {
    return new GardenerFs(workspaceId, sourceId, jobId, scopes);
  }

  // The content mutations performed so far, in order.
  ops(): readonly GardenerOp[] {
    return this.recordedOps;
  }

  // Human-readable rendering of the write boundary for error messages.
  private fenceLabel(): string {
    if (this.fences === null) return "(unrestricted)";
    return (
      this.fences.map((f) => f.prefix || "(workspace root)").join(", ") ||
      "(none)"
    );
  }

  private assertInFence(path: string, verb: string): void {
    if (!this.inFence(path)) {
      throw new VfsError(
        `cannot ${verb} "${path}" — outside the writable scope (${this.fenceLabel()})`,
      );
    }
  }

  private mutationOrderLock() {
    return db
      .select({ id: Workspace.id })
      .from(Workspace)
      .where(eq(Workspace.id, this.workspaceId))
      .for("update");
  }

  private prepareMutation(changes: MemoryMutationChange[], message: string) {
    const id = randomUUID();
    return {
      id,
      statement: db.insert(MemoryMutation).values({
        id,
        workspaceId: this.workspaceId,
        changes,
        message,
        sourceId: this.sourceId,
        jobId: this.jobId,
      }),
    };
  }

  // Shared guard for subtree-wide mutations (mv/rm): resolves the subtree rooted
  // at `path`, then refuses empty/pinned/restricted/grant-anchored subtrees with
  // the verb baked into the messages. `mustNotExist` (mv's destination) is
  // checked between the pinned and restricted gates to preserve the original
  // error ordering. Returns the in-scope nodes for the caller's UPDATE.
  private async assertSubtreeMutable(
    path: string,
    verb: string,
    mustNotExist?: string,
  ): Promise<NodeRow[]> {
    const nodes = await this.listNodes();
    const scope = nodes.filter(
      (n) => n.path === path || n.path.startsWith(`${path}/`),
    );
    if (scope.length === 0) throw new VfsError(`nothing at "${path}"`);
    const pinnedNode = scope.find((n) => n.pinned);
    if (pinnedNode) {
      throw new VfsError(
        `"${pinnedNode.path}" is pinned — cannot ${verb} "${path}"`,
      );
    }
    if (
      mustNotExist !== undefined &&
      nodes.some((n) => n.path === mustNotExist)
    ) {
      throw new VfsError(`"${mustNotExist}" already exists`);
    }

    if (scope.some((n) => n.restricted)) {
      throw new VfsError(
        `the subtree contains a restricted folder — ask a workspace admin to reorganize it`,
      );
    }
    const anchored = await db
      .select({ folderId: AccessGrant.folderId })
      .from(AccessGrant)
      .where(
        inArray(
          AccessGrant.folderId,
          scope.map((n) => n.id),
        ),
      )
      .limit(1);
    if (anchored.length > 0) {
      throw new VfsError(
        `the subtree contains folders with access grants — ask a workspace admin to reorganize it`,
      );
    }
    return scope;
  }

  async write(path: string, body: string, summary: string): Promise<string> {
    this.assertInFence(path, "write");

    const existing = await this.getNodeByPath(path);
    if (existing?.pinned) {
      throw new VfsError(
        `"${path}" is pinned — the user locked it; leave it unchanged`,
      );
    }

    if (!existing) {
      const segErr = kebabSegmentError(folderPrefixOf(path));
      if (segErr) throw new VfsError(segErr);
      const leafErr = noteLeafError(path);
      if (leafErr) throw new VfsError(leafErr);
    }

    // Carry the previous note's frontmatter forward unless the gardener's new
    // body declares its own, so a whole-body rewrite never silently drops the
    // note's tags/title (which live in frontmatter, managed via
    // set_tags/set_title).
    const parsed = parseOkf(body);
    if (!parsed.declared && existing?.currentVersionId) {
      const previousBody = await this.read(path).catch(() => null);
      if (previousBody) parsed.meta = parseOkf(previousBody).meta;
    }

    // OKF: the DB `kind` column is a rendering hint derived from the body's
    // frontmatter `type` (unknown types → "note").
    const kind = kindForType(parsed.meta.type);

    const insertedTitle = parsed.meta.title ?? null;
    if (!existing && !insertedTitle) {
      throw new VfsError(
        `new notes must declare a title via frontmatter — add "---\\ntitle: My Note\\n---" to the top of the body for "${path}"`,
      );
    }
    const nodeId = existing?.id ?? randomUUID();
    const currentTitle = existing?.title ?? insertedTitle;
    if (!currentTitle) throw new Error("memory title invariant failed");

    await this.writeVersion({
      nodeId,
      path,
      parsed,
      summary,
      currentTitle,
      mutationMessage: `${existing ? "Update" : "Create"} ${path}`,
      newNode: existing
        ? undefined
        : {
            path,
            kind,
            title: currentTitle,
          },
    });
    this.recordedOps.push({
      op: existing ? "update" : "create",
      kind,
      path,
      nodeId,
    });
    return existing ? `updated "${path}"` : `created "${path}"`;
  }

  async edit(path: string, oldText: string, newText: string): Promise<string> {
    this.assertInFence(path, "edit");

    const node = await this.getNodeByPath(path);
    if (!node) throw new VfsError(`no note at "${path}"`);
    if (node.pinned) {
      throw new VfsError(
        `"${path}" is pinned — the user locked it; leave it unchanged`,
      );
    }

    const body = await this.read(path);
    const count = body.split(oldText).length - 1;
    if (count === 0) {
      throw new VfsError(
        `oldText not found in "${path}" — read the note again; its content may differ from what you expect`,
      );
    }
    if (count > 1) {
      throw new VfsError(
        `oldText appears ${count} times in "${path}" — include more surrounding context to make it unique`,
      );
    }

    const parsed = parseOkf(body.replace(oldText, newText));
    await this.writeVersion({
      nodeId: node.id,
      path,
      parsed,
      summary: node.summary ?? "",
      currentTitle: node.title,
      mutationMessage: `Edit ${path}`,
    });
    this.recordedOps.push({
      op: "update",
      kind: kindForType(parsed.meta.type),
      path,
      nodeId: node.id,
    });
    return `edited "${path}"`;
  }

  // Set a note's tags. Tags are stored canonically in body frontmatter and
  // serialized deterministically (the model never hand-writes YAML); the
  // derived wiki_node_tag index is recomputed by writeVersion.
  async setTags(path: string, tags: string[]): Promise<string> {
    this.assertInFence(path, "set tags on");

    const node = await this.getNodeByPath(path);
    if (!node) throw new VfsError(`no note at "${path}"`);
    if (node.pinned) {
      throw new VfsError(
        `"${path}" is pinned — the user locked it; leave it unchanged`,
      );
    }

    const normalized = normalizeTags(tags);
    const parsed = parseOkf(await this.read(path));
    if (normalized.length > 0) parsed.meta.tags = normalized;
    else delete parsed.meta.tags;
    await this.writeVersion({
      nodeId: node.id,
      path,
      parsed,
      summary: node.summary ?? "",
      currentTitle: node.title,
      mutationMessage: `Update tags for ${path}`,
    });
    return normalized.length > 0
      ? `tagged "${path}": ${normalized.join(", ")}`
      : `cleared tags on "${path}"`;
  }

  // Override a note's display title. Stored canonically in body frontmatter,
  // same mechanism as tags; the derived WikiNode.title column is recomputed
  // by writeVersion. Every note requires a real title — there is no
  // path-derived fallback to clear back to, so this always sets a new one.
  async setTitle(path: string, title: string): Promise<string> {
    this.assertInFence(path, "set title on");

    const node = await this.getNodeByPath(path);
    if (!node) throw new VfsError(`no note at "${path}"`);
    if (node.pinned) {
      throw new VfsError(
        `"${path}" is pinned — the user locked it; leave it unchanged`,
      );
    }

    const normalized = normalizeTitle(title);
    if (!normalized) {
      throw new VfsError(`title cannot be empty`);
    }
    const parsed = parseOkf(await this.read(path));
    parsed.meta.title = normalized;
    await this.writeVersion({
      nodeId: node.id,
      path,
      parsed,
      summary: node.summary ?? "",
      currentTitle: node.title,
      mutationMessage: `Update title for ${path}`,
    });
    return `titled "${path}": ${normalized}`;
  }

  // Attribute source ids to a note — additive, never removes existing
  // citations. Call this on the surviving note before rm'ing a note you
  // merged into it, so that note's provenance isn't lost once it's deleted
  // (its own version history, and the sources on it, go with it).
  // Frontmatter-canonical: the URIs are folded into the body's `sources`
  // list and persisted as a new version; writeVersion's additive projection
  // then keeps wiki_node_source in sync.
  async citeSources(path: string, sourceIds: string[]): Promise<string> {
    this.assertInFence(path, "cite sources on");

    const node = await this.getNodeByPath(path);
    if (!node) throw new VfsError(`no note at "${path}"`);
    if (node.pinned) {
      throw new VfsError(
        `"${path}" is pinned — the user locked it; leave it unchanged`,
      );
    }

    const unique = [...new Set(sourceIds)];
    const validRows = await db
      .select({ id: Source.id })
      .from(Source)
      .where(
        and(
          eq(Source.workspaceId, this.workspaceId),
          inArray(Source.id, unique),
        ),
      );
    const validIds = unique.filter((id) => validRows.some((r) => r.id === id));
    if (validIds.length === 0) {
      throw new VfsError(
        `none of the given source ids exist in this workspace`,
      );
    }

    const parsed = parseOkf(await this.read(path));
    parsed.meta.sources = [
      ...new Set([
        ...(parsed.meta.sources ?? []),
        ...validIds.map(sourceUriFor),
      ]),
    ];
    await this.writeVersion({
      nodeId: node.id,
      path,
      parsed,
      summary: node.summary ?? "",
      currentTitle: node.title,
      mutationMessage: `Update citations for ${path}`,
    });

    const skipped = unique.length - validIds.length;
    return skipped > 0
      ? `cited ${String(validIds.length)} source(s) on "${path}" (${String(skipped)} invalid id(s) skipped)`
      : `cited ${String(validIds.length)} source(s) on "${path}"`;
  }

  async mv(from: string, to: string): Promise<string> {
    this.assertInFence(from, "move");
    this.assertInFence(to, "move to");

    if (from === to) throw new VfsError("from and to are identical");

    const scope = await this.assertSubtreeMutable(from, "move", to);

    // Only require the .md leaf when this is unambiguously a single
    // concept's own rename — a subtree/folder-prefix rename keeps each
    // child's own leaf name intact via the substring below, and "to" itself
    // is a folder-style prefix with no extension of its own. Every concept
    // (notes and datasets alike) is OKF markdown, so .md is the only leaf.
    const onlyMatch = scope.length === 1 ? scope[0] : undefined;
    if (onlyMatch?.kind === "note" || onlyMatch?.kind === "dataset") {
      const segErr = kebabSegmentError(folderPrefixOf(to));
      if (segErr) throw new VfsError(segErr);
      const leafErr = noteLeafError(to);
      if (leafErr) throw new VfsError(leafErr);
    } else {
      const segErr = kebabSegmentError(to);
      if (segErr) throw new VfsError(segErr);
    }

    // One UPDATE so the subtree rename is atomic (neon-http has no
    // interactive transactions). substring() is 1-indexed: for the exact
    // match the suffix is empty; for children it keeps "/rest/of/path".
    const mutation = this.prepareMutation(
      [{ type: "move", from, to }],
      `Move ${from} to ${to}`,
    );
    await db.batch([
      this.mutationOrderLock(),
      db
        .update(WikiNode)
        .set({
          path: sql`${to} || substring(${WikiNode.path} from ${from.length + 1})`,
        })
        .where(
          and(
            eq(WikiNode.workspaceId, this.workspaceId),
            isNull(WikiNode.deletedAt),
            inArray(
              WikiNode.id,
              scope.map((n) => n.id),
            ),
          ),
        ),
      mutation.statement,
    ]);

    for (const n of scope) this.bodyCache.delete(n.path);
    await notifyMemoryGitProjection({
      mutationId: mutation.id,
      workspaceId: this.workspaceId,
    });
    return `moved ${scope.length} note(s) from "${from}" to "${to}"`;
  }

  async rm(path: string): Promise<string> {
    this.assertInFence(path, "delete");

    const scope = await this.assertSubtreeMutable(path, "delete");

    const mutation = this.prepareMutation(
      [{ type: "delete", path }],
      `Delete ${path}`,
    );
    await db.batch([
      this.mutationOrderLock(),
      db
        .update(WikiNode)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(WikiNode.workspaceId, this.workspaceId),
            isNull(WikiNode.deletedAt),
            inArray(
              WikiNode.id,
              scope.map((n) => n.id),
            ),
          ),
        ),
      mutation.statement,
    ]);

    for (const n of scope) this.bodyCache.delete(n.path);
    await notifyMemoryGitProjection({
      mutationId: mutation.id,
      workspaceId: this.workspaceId,
    });
    this.recordedOps.push({
      op: "delete",
      path,
      nodeIds: scope.map((n) => n.id),
    });
    return `deleted ${scope.length} note(s) at "${path}" (soft delete — recoverable)`;
  }

  // Append-only version flow: immutable S3 body → one atomic batch containing
  // the version, live node pointer, and mutation journal → derived indexes.
  // The OKF pipeline — every stored body funnels through here. Callers hand
  // over a ParsedOkf (parse once, mutate meta); this stamps server-owned
  // fields (title fallback, description from the write's summary, timestamp,
  // this job's source URI), serializes exactly once, then projects the
  // frontmatter into the derived Postgres index (title/kind on wiki_node,
  // summary on the version, wiki_node_tag, wiki_node_source). Frontmatter is
  // canonical; the DB never diverges from it.
  private async writeVersion(input: WriteVersionInput): Promise<void> {
    const {
      nodeId,
      path,
      parsed,
      summary,
      currentTitle,
      mutationMessage,
      newNode,
    } = input;
    const { meta, content } = parsed;
    // Server-owned stamping is entirely the registry's `stamp` policy
    // (okf/schema.ts): title and description fall back to these values only
    // when the body declares none, timestamp is always overwritten, and this
    // job's source URI is folded into `sources`. Note description is a
    // *fallback*: an agent-synthesized summary no longer overwrites a
    // human-written description — the body wins.
    stampServerFields(meta, {
      fallbackTitle: currentTitle,
      fallbackDescription: summary,
      sourceId: this.sourceId,
    });
    const stored = serializeOkf(meta, content);
    const projected = projectToDb(meta);
    const versionSummary = projected.summary ?? "";

    const versionId = randomUUID();
    const bodyKey = s3.s3KeyFor.wikiBody(this.workspaceId, versionId);
    await s3.putObject(bodyKey, stored, "text/markdown");

    const mutation = this.prepareMutation(
      [{ type: "upsert", path, versionId }],
      mutationMessage,
    );
    // Title and kind live directly on WikiNode (unlike tags/sources, no
    // separate index table), so they ride the same atomic update as
    // currentVersionId rather than a best-effort side call.
    const insertVersion = db.insert(WikiNodeVersion).values({
      id: versionId,
      nodeId,
      workspaceId: this.workspaceId,
      s3Key: bodyKey,
      summary: versionSummary,
      sourceId: this.sourceId,
    });
    const updateNode = db
      .update(WikiNode)
      .set({
        currentVersionId: versionId,
        title: projected.title ?? currentTitle,
        kind: projected.kind,
      })
      .where(eq(WikiNode.id, nodeId));
    // A workspace row lock makes the global mutation sequence agree with the
    // committed per-workspace write order, even when separate paths are
    // updated concurrently. The projector can therefore stay strictly linear.
    if (newNode) {
      await db.batch([
        this.mutationOrderLock(),
        db.insert(WikiNode).values({
          id: nodeId,
          workspaceId: this.workspaceId,
          ...newNode,
        }),
        insertVersion,
        updateNode,
        mutation.statement,
      ]);
    } else {
      await db.batch([
        this.mutationOrderLock(),
        insertVersion,
        updateNode,
        mutation.statement,
      ]);
    }

    this.bodyCache.set(path, stored);
    await notifyMemoryGitProjection({
      mutationId: mutation.id,
      workspaceId: this.workspaceId,
    });

    // Best-effort indexing — the write already succeeded; an embedding
    // hiccup must not fail the compile job. Backfill re-indexes later.
    try {
      await indexNodeVersion({
        nodeVersionId: versionId,
        workspaceId: this.workspaceId,
        kind: projected.kind,
        body: stored,
        summary: versionSummary,
        jobId: this.jobId ?? undefined,
      });
    } catch (err) {
      console.error("[gardener] indexing failed; leaving for backfill", err);
    }

    // Derived tag index: frontmatter is the source of truth, recomputed on
    // every version so wiki_node_tag stays in sync without parsing S3 bodies
    // at read time. Best-effort, like embeddings above.
    try {
      await this.reindexTags(nodeId, projected.tags);
    } catch (err) {
      console.error(
        "[gardener] tag indexing failed; leaving for backfill",
        err,
      );
    }

    // Derived provenance index: frontmatter `sources` (which already unions
    // this job's source, stamped above) → wiki_node_source. A destructive
    // replace, exactly like tags: the body is the source of truth, so a URI
    // removed from frontmatter must disappear from the index too. (This was
    // insert-only, which let the Sources panel keep showing provenance the
    // body no longer claimed.) Best-effort, like the indexes above.
    try {
      await this.reindexSources(nodeId, projected.sourceIds);
    } catch (err) {
      console.error(
        "[gardener] source citation indexing failed; leaving for backfill",
        err,
      );
    }
  }

  // Replace the node's wiki_node_source rows with the ids in the current
  // body's frontmatter. Mirrors reindexTags — same recompute-on-every-version
  // contract, so both join tables converge from one place.
  private async reindexSources(
    nodeId: string,
    sourceIds: string[],
  ): Promise<void> {
    await db.delete(WikiNodeSource).where(eq(WikiNodeSource.nodeId, nodeId));
    if (sourceIds.length > 0) {
      await db
        .insert(WikiNodeSource)
        .values(
          sourceIds.map((sourceId) => ({
            workspaceId: this.workspaceId,
            nodeId,
            sourceId,
          })),
        )
        .onConflictDoNothing({
          target: [WikiNodeSource.nodeId, WikiNodeSource.sourceId],
        });
    }
  }

  // Replace the node's wiki_node_tag rows with the tags in the current body's
  // frontmatter. Runs for every version so write/edit/setTags all converge on
  // one index path.
  private async reindexTags(nodeId: string, tags: string[]): Promise<void> {
    await db.delete(WikiNodeTag).where(eq(WikiNodeTag.nodeId, nodeId));
    if (tags.length > 0) {
      await db
        .insert(WikiNodeTag)
        .values(
          tags.map((tag) => ({ workspaceId: this.workspaceId, nodeId, tag })),
        );
    }
  }
}
