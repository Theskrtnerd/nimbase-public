// The MemoryNode contract DTO — the format-agnostic memory record the
// MemoryProvider seam trades in. This is deliberately NOT the Drizzle row: it is
// the stable shape callers (MCP tools, tRPC routers, the CLI, evals) depend on,
// so the underlying storage (today: WikiNode + WikiNodeVersion + S3 body) can
// change without rippling through every call site. See
// docs/architecture/memory-kernel.md for the ratified grain decision.

// A byte/character span into a source or a node's content. Reserved for a future
// finer-than-note grain (fact extraction — backlog); UNUSED at whole-note grain.
export interface Span {
  start: number;
  end: number;
}

// Provenance pointer: where a node's content came from. `uri` identifies the
// source (e.g. the original capture), `checksum` is the content hash of that
// source at the time it was folded in (WikiNodeVersion/Source provenance chain),
// `version` names the source revision. `span` is optional and only meaningful
// once nodes get finer than whole-note.
export interface SourceRef {
  uri: string;
  checksum?: string;
  version?: string;
  span?: Span;
}

// Open string union. Carries today's grains (folder rows are NOT memory nodes,
// so they never appear here). Left open (`string & {}`) so a future finer grain
// — e.g. "fact" — can join without a v2 contract; the intersection keeps the
// literal autocomplete while still accepting arbitrary strings.
export type MemoryKind = "note" | "dataset" | (string & {});

// Node metadata. `path` is wiki-flavored (the folder path this memory lives at)
// but broadly useful for locating and scoping a node, so it is promoted to a
// named field; everything else rides in the open index signature.
export interface MemoryNodeMetadata {
  path: string;
  [key: string]: unknown;
}

// The contract DTO. `id` is the same UUID as the backing WikiNode (1:1,
// whole-note grain — ratified). `content` is assembled from the current
// WikiNodeVersion S3 body by the provider implementation.
export interface MemoryNode {
  // === WikiNode.id (same UUID, 1:1).
  id: string;
  kind: MemoryKind;
  // The OKF frontmatter `type` (e.g. "Note", "Dataset", "Company Profile").
  // Open vocabulary per the OKF spec; populated by `fetch` from the body's
  // frontmatter (defaulting to "Note" for legacy bodies), omitted on the
  // lean nodes `search`/`neighbors` return.
  type?: string;
  title: string;
  // Assembled from the current WikiNodeVersion S3 body by the provider.
  content: string;
  metadata: MemoryNodeMetadata;
  labels: string[];
  // Rich provenance is the `provenance()` op's job, not `fetch`'s: the lossy
  // whole-note SourceRef contract (`{uri}`) can't carry the detail note-detail
  // surfaces show, and no caller consumes fetch's sources. So `fetch` leaves
  // this empty and callers wanting sources call `provenance()`. Populated only
  // by `upsert` (echoing the just-written node).
  sources: SourceRef[];
  // One-line tree/search summary, when the note has one (`null` when it
  // doesn't). Populated by `fetch`/`upsert`; omitted from the lean nodes
  // `search`/`neighbors` return.
  summary?: string | null;
  // Last-modified time of the backing note. Populated by `fetch`; omitted from
  // `search`/`neighbors` nodes (they don't carry freshness).
  updatedAt?: Date;

  // Fact-ready reserved fields — so a future finer-grained kind can join the
  // contract without a v2. Both are UNUSED at whole-note grain (fact extraction
  // is not built here). `parentId` would point a fact at its owning note; `span`
  // would locate it within that note's content.
  parentId?: string;
  span?: Span;
}
