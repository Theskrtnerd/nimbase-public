// Pure merge/sort logic moved to @acme/db (packages/db/src/node-metadata-merge.ts)
// alongside loadNodeSources so @acme/cloud can reuse it (NOT-58). Re-exported
// from the PURE @acme/db subpath — never @acme/db/node-metadata, which pulls in
// @acme/db/client (throws without POSTGRES_URL) — so this stays importable in
// the colocated test. Kept as the stable import path for existing call sites.
export type { NodeSourceRef, SourceRow } from "@acme/db/node-metadata-merge";
export { mergeSourceRows } from "@acme/db/node-metadata-merge";
