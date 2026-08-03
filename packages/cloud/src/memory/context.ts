import type { PathScope } from "@acme/db";
import type { GrantRole } from "@acme/db/schema";

// Branded, vision-shaped access context threaded through every MemoryProvider
// op. It is the kernel half of double enforcement: tool routers keep their own
// capability checks, and each provider op independently asserts its toolset
// against this context. See docs/architecture/memory-kernel.md.
//
// The context is constructible ONLY via `toProviderContext` — the brand below
// is a module-private unique symbol, so an object literal from outside this
// module can never satisfy the interface. Hand-rolling one is a compile error.

// A toolset is a coarse permission band the provider gates ops on. Derived from
// the resolved access's role scopes; the fine-grained per-path decision still
// happens SQL-side (scopes compiled into WHERE clauses), never as a JS predicate
// in the read path.
export type Toolset = "read" | "capture" | "admin";

// The role each toolset is derived from (access.ts capability naming):
//   canRead    → read     (viewer)
//   canCapture → capture  (contributor)
//   canManage  → admin    (manager)
const TOOLSET_ROLE: Record<Toolset, GrantRole> = {
  read: "viewer",
  capture: "contributor",
  admin: "manager",
};

// Per-toolset scope DATA the provider compiles into SQL. `null` = unrestricted
// (admin bypass); `[]` = no access at that toolset; otherwise the path prefixes
// to filter on. This mirrors exactly what access.ts's `scopes(minRole)`
// produces — it is filter data, not a predicate.
export type ProviderScopes = Readonly<Record<Toolset, PathScope[] | null>>;

// Rate/quota limits. Shipped in the type but UNENFORCED — the rate-limit work
// (Linear NOT-70) will wire these into the provider read/write paths.
export interface ProviderLimits {
  readonly maxResults?: number;
  readonly requestsPerMinute?: number;
}

// Module-private brand. A real (unexported) unique symbol: external modules
// cannot name this key, so they cannot construct an object literal that
// satisfies the interface — hand-rolling a context is a compile error.
const providerContextBrand = Symbol("providerContextBrand");

export interface ProviderAccessContext {
  readonly [providerContextBrand]: true;
  // The acting principal (WorkspaceMember userId, agent id, …). `null` for an
  // anonymous/public principal (e.g. a public share read path).
  readonly principalId: string | null;
  readonly workspaceId: string;
  readonly allowedToolsets: ReadonlySet<Toolset>;
  readonly scopes: ProviderScopes;
  readonly limits: ProviderLimits;
}

// Minimal structural view of the resolved access object. SOURCE OF TRUTH:
// packages/api/src/lib/access.ts (`AccessContext` built by `buildAccessContext`).
// @acme/cloud must not depend on @acme/api, so this restates only the fields the
// mapper reads. Keep in sync with access.ts if that shape changes.
export interface ResolvedAccessLike {
  readonly workspaceId: string;
  readonly userId: string | null;
  // null = unrestricted (admin). [] = no access at this role.
  scopes(minRole: GrantRole): PathScope[] | null;
}

// A toolset is granted iff its role scopes are unrestricted (admin) OR contain
// at least one prefix. Empty scopes ([]) mean no access → toolset withheld.
function grantsToolset(scopes: PathScope[] | null): boolean {
  return scopes === null || scopes.length > 0;
}

// The ONLY constructor for a ProviderAccessContext. Derives `allowedToolsets`
// from the resolved access's role scopes and snapshots the per-toolset scope
// data for the provider to compile into SQL.
export function toProviderContext(
  access: ResolvedAccessLike,
): ProviderAccessContext {
  const scopes: Record<Toolset, PathScope[] | null> = {
    read: access.scopes(TOOLSET_ROLE.read),
    capture: access.scopes(TOOLSET_ROLE.capture),
    admin: access.scopes(TOOLSET_ROLE.admin),
  };

  const allowed = new Set<Toolset>();
  for (const toolset of Object.keys(scopes) as Toolset[]) {
    if (grantsToolset(scopes[toolset])) allowed.add(toolset);
  }

  return {
    [providerContextBrand]: true,
    principalId: access.userId,
    workspaceId: access.workspaceId,
    allowedToolsets: allowed,
    scopes,
    limits: {},
  };
}

export class ToolsetForbiddenError extends Error {
  constructor(readonly toolset: Toolset) {
    super(`Principal is not allowed the "${toolset}" toolset`);
    this.name = "ToolsetForbiddenError";
  }
}

// Toolset-assertion helper provider implementations call before an op. Throws
// ToolsetForbiddenError when the context does not carry the required toolset.
// This is the kernel-side gate; tool routers keep their own checks too.
export function assertToolset(
  ctx: ProviderAccessContext,
  toolset: Toolset,
): void {
  if (!ctx.allowedToolsets.has(toolset)) {
    throw new ToolsetForbiddenError(toolset);
  }
}

export function hasToolset(
  ctx: ProviderAccessContext,
  toolset: Toolset,
): boolean {
  return ctx.allowedToolsets.has(toolset);
}
