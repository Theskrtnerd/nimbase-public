// Provenance/tag loaders moved to @acme/db (packages/db/src/node-metadata.ts)
// so @acme/runtime's MemoryProvider can reuse them without depending on @acme/api
// (see docs/architecture/memory-kernel.md, NOT-58). This module stays as the
// stable import path for existing call sites (kb router, kb/get-note, compile
// vfs) — behavior is identical.
export type { NodeSourceRef } from "@acme/db/node-metadata";
export {
  loadNodeSources,
  loadNodeTags,
  mergeSourceRows,
} from "@acme/db/node-metadata";
