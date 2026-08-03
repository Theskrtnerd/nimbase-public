import type { PathScope } from "@acme/db";

import type { ProviderAccessContext, Toolset } from "./context";
import type { MemoryKind, MemoryNode, SourceRef, Span } from "./node";
import { assertToolset } from "./context";

// The seven MemoryProvider operations. `capabilities` advertises which a given
// implementation actually supports; callers MUST check `capabilities` (or
// `hasCapability`) before invoking an optional op — the wiki/Postgres provider,
// for instance, ships without `link` (no edge table yet).
export type Capability =
  | "search"
  | "fetch"
  | "neighbors"
  | "upsert"
  | "link"
  | "reconcile"
  | "provenance";

// Which toolset each op requires. Reads need the read toolset; writes need
// capture. The provider asserts this per op (see `assertOpToolset`) as the
// kernel half of double enforcement.
export const OP_TOOLSET: Record<Capability, Toolset> = {
  search: "read",
  fetch: "read",
  neighbors: "read",
  provenance: "read",
  upsert: "capture",
  link: "capture",
  reconcile: "capture",
};

export interface MemorySearchQuery {
  text: string;
  limit?: number;
  kinds?: MemoryKind[];
}

export interface MemorySearchResult {
  node: MemoryNode;
  score: number;
}

export interface NeighborsOptions {
  limit?: number;
}

// Write input. `id` present = update that node; absent = create. `content` is
// the assembled body the provider will persist (WikiNodeVersion + S3). The
// reserved `parentId`/`span` mirror MemoryNode and are unused at whole-note
// grain.
export interface MemoryUpsertInput {
  id?: string;
  kind: MemoryKind;
  // OKF frontmatter `type` (open vocabulary — e.g. "Company Profile").
  // Overrides the kind-derived default ("Dataset" for kind: "dataset").
  type?: string;
  title: string;
  content: string;
  // Lands in `metadata.path` on the resulting node. Required by `upsert` —
  // a direct write needs an explicit target path.
  path?: string;
  // One-line tree/search summary. Falls back to `title` when omitted.
  summary?: string;
  labels?: string[];
  sources?: SourceRef[];
  parentId?: string;
  span?: Span;
}

export interface MemoryLink {
  fromId: string;
  toId: string;
  relation: string;
}

// The candidate a reconcile folds into memory: a raw captured source, NOT a
// resulting node. Kept distinct from MemoryUpsertInput so `sourceKind` (the
// capture's medium — "web"/"screenshot"/…) is never conflated with a node's
// MemoryKind (note/dataset); the strategy decides the resulting grain itself.
export interface ReconcileCandidate {
  sourceKind: string;
  // The capture's title, when it has one (missing for URL-less captures).
  title?: string;
  // The raw text the strategy integrates.
  content: string;
}

// Operational context a reconcile needs beyond the candidate content. The wiki
// provider runs its reconcile through the gardener — an LLM agent over the
// internal VFS — so it needs the `fence` to bound the write, the originating
// `sourceId`/`jobId` for provenance + telemetry. The provider resolves its own
// model (per-workspace AI config), so the caller passes none. Path scopes are
// enforced by the VFS against the fence (not re-checked here); the provider
// only asserts the write toolset.
export interface ReconcileOptions {
  sourceId: string;
  jobId: string;
  fence: PathScope;
}

// LLM token usage a reconcile consumed, for the caller's cost accounting. Plain
// counts — no dependency on the AI SDK.
export interface ReconcileUsage {
  inputTokens: number;
  outputTokens: number;
}

// Typed reconcile outcome — the front door for a provider's conflict strategy
// (the wiki provider routes this through the gardener; Linear NOT-61). Replaces
// freeform "just edit it" writes so callers/evals can reason about what
// changed. `action` is a HEURISTIC derived from the mutations the strategy
// actually performed (not its prose report), collapsing a possibly-multi-op run
// to one label:
//   insert    — a new node was created (and nothing retired)
//   merge     — an existing node was edited/rewritten in place
//   supersede — content landed in a survivor AND one or more nodes were retired
//   noop      — no content was created or changed (or the run only did
//               housekeeping deletes)
// Deletions that don't accompany a surviving write are housekeeping, not a
// supersede: they surface in `deletedIds` while `action` reflects the remaining
// content ops.
export type ReconcileAction = "insert" | "merge" | "supersede" | "noop";

export interface ReconcileResult {
  action: ReconcileAction;
  // The node the candidate landed on (insert/merge target, or the survivor of
  // a supersede). Absent for a noop.
  nodeId?: string;
  // Nodes retired by a supersede (content moved into `nodeId`). Empty/absent
  // for other actions.
  supersededIds?: string[];
  // Nodes deleted as housekeeping WITHOUT a surviving write (redundant notes
  // removed). Absent when there were none. Distinct from `supersededIds`, which
  // is the retire-half of a supersede.
  deletedIds?: string[];
  // The strategy's human-readable summary of what changed — the gardener's
  // report for the wiki provider. Surfaced to the user / stored on the source.
  report: string;
  // Token usage the reconcile consumed, for cost accounting.
  usage: ReconcileUsage;
}

// The stable memory seam. One implementation exists today (wiki/Postgres); it
// lives behind this interface in @acme/cloud so backends stay swappable and
// call sites depend only on the contract. See docs/architecture/memory-kernel.md.
// The method set, `Capability`, and `OP_TOOLSET` are maintained in parallel —
// adding an op means updating all three.
export interface MemoryProvider {
  readonly capabilities: ReadonlySet<Capability>;

  // Ranked retrieval. Each result's `node.content` carries the best-matching
  // SNIPPET the search leg surfaces, NOT the full note body — this keeps search
  // a single query with no per-hit body fetch. Call `fetch(id)` to get a node's
  // full assembled content.
  search(
    ctx: ProviderAccessContext,
    query: MemorySearchQuery,
  ): Promise<MemorySearchResult[]>;

  // Full node by id (read-scoped). The returned node's `sources` is EMPTY:
  // rich provenance is `provenance()`'s job — the whole-note SourceRef contract
  // (`{uri}`) is lossy vs. what note-detail surfaces show, and no caller
  // consumes fetch's sources. Call `provenance(id)` for source refs.
  fetch(ctx: ProviderAccessContext, id: string): Promise<MemoryNode | null>;

  neighbors(
    ctx: ProviderAccessContext,
    id: string,
    options?: NeighborsOptions,
  ): Promise<MemoryNode[]>;

  upsert(
    ctx: ProviderAccessContext,
    input: MemoryUpsertInput,
  ): Promise<MemoryNode>;

  link(ctx: ProviderAccessContext, edge: MemoryLink): Promise<void>;

  reconcile(
    ctx: ProviderAccessContext,
    candidate: ReconcileCandidate,
    options: ReconcileOptions,
  ): Promise<ReconcileResult>;

  provenance(ctx: ProviderAccessContext, id: string): Promise<SourceRef[]>;
}

export function hasCapability(
  provider: Pick<MemoryProvider, "capabilities">,
  capability: Capability,
): boolean {
  return provider.capabilities.has(capability);
}

// Per-op toolset assertion provider implementations call at the top of each op:
// `assertOpToolset(ctx, "search")`. Delegates to the shared `assertToolset`.
export function assertOpToolset(
  ctx: ProviderAccessContext,
  op: Capability,
): void {
  assertToolset(ctx, OP_TOOLSET[op]);
}

// Thrown by an op a provider's `capabilities` set does not advertise. Callers
// MUST check `capabilities` (or `hasCapability`) before an optional op; reaching
// an unsupported op is a programming error surfaced as this typed error rather
// than a silent no-op (e.g. the wiki/Postgres provider ships without `link` —
// there is no edge table yet).
export class CapabilityNotSupportedError extends Error {
  constructor(readonly capability: Capability) {
    super(
      `This MemoryProvider does not support the "${capability}" capability`,
    );
    this.name = "CapabilityNotSupportedError";
  }
}
