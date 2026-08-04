// INTERNAL to the wiki MemoryProvider. This is the write/read machinery of the
// wiki/Postgres backend (the VFS, its read tools, and the compile gardener) —
// the concrete storage implementation behind WikiPgProvider. Code outside
// packages/cloud must NOT import it directly; depend on the MemoryProvider
// contract (@acme/cloud/memory) instead. The one sanctioned external consumer is
// artifact/agent read-tool wiring (readTools + WikiReadFs), until that moves
// behind the provider too. See docs/architecture/memory-kernel.md (NOT-60).
export { GardenerFs, VfsError, WikiReadFs } from "./vfs";
export type {
  GardenerDeleteOp,
  GardenerOp,
  GardenerWriteOp,
  WikiEntry,
} from "./vfs";
export { readTools, vfsCall } from "./vfs-read-tools";
export { GardenerError } from "./gardener";
export type { GardenerResult } from "./gardener";
export { normalizeTitle } from "../okf/normalize";
