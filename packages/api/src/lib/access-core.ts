// Pure permission algebra moved to @acme/db (packages/db/src/access-core.ts) so
// @acme/runtime's wiki VFS can reuse `pathInScopes`/`PathScope` without depending
// on @acme/api (see docs/architecture/memory-kernel.md, NOT-60). This module
// stays as the stable import path for existing call sites (access.ts, the agent
// chat route, compile/process) — behavior is identical.
export type { PathScope, ResolvedGrant } from "@acme/db/access-core";
export {
  computeScopes,
  hasRoleAtPath,
  intersectScopes,
  pathInScopes,
  prefixCovers,
  roleAtPath,
} from "@acme/db/access-core";
