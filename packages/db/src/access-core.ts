// Pure permission algebra — no DB, no IO. The restricted-boundary rule:
// a grant applies to a path iff the grant prefix covers the path AND the
// grant is rooted at-or-inside every restricted folder above that path.
//
// Normalization precondition: all paths and prefixes are assumed normalized —
// no leading slash, no trailing slash, no duplicate slashes (e.g. "a/b/c").
// The empty string "" represents the workspace root and is a valid prefix.
// restricted="" is a no-op by design (prefixCovers("", x) is always true, so
// a root-level restricted boundary blocks no grants without a root grant).
import type { PathScope } from "./path-scope";
import type { GrantRole } from "./schema";

// PathScope is defined in @acme/db (shared with search); re-exported here so the
// access layer and its existing importers keep a single import site.
export type { PathScope };

const ROLE_RANK: Record<GrantRole, number> = {
  viewer: 0,
  contributor: 1,
  manager: 2,
};
const ROLE_BY_RANK: readonly GrantRole[] = [
  "viewer",
  "contributor",
  "manager",
] as const;

function rankOf(role: GrantRole): number {
  return ROLE_RANK[role];
}

function roleByRank(rank: number): GrantRole | null {
  return ROLE_BY_RANK[rank] ?? null;
}

export interface ResolvedGrant {
  prefix: string; // "" = workspace root
  role: GrantRole;
}

export function prefixCovers(prefix: string, path: string): boolean {
  return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
}

export function roleAtPath(
  grants: ResolvedGrant[],
  restricted: string[],
  path: string,
): GrantRole | null {
  let best = -1;
  for (const grant of grants) {
    if (!prefixCovers(grant.prefix, path)) continue;
    const blocked = restricted.some(
      (r) => prefixCovers(r, path) && !prefixCovers(r, grant.prefix),
    );
    const rank = rankOf(grant.role);
    if (!blocked && rank > best) best = rank;
  }
  return roleByRank(best);
}

export function hasRoleAtPath(
  grants: ResolvedGrant[],
  restricted: string[],
  path: string,
  min: GrantRole,
): boolean {
  const role = roleAtPath(grants, restricted, path);
  return role !== null && rankOf(role) >= rankOf(min);
}

// Compile grants into SQL-able allow/exclude intervals for a minimum role.
export function computeScopes(
  grants: ResolvedGrant[],
  restricted: string[],
  minRole: GrantRole,
): PathScope[] {
  const minRank = rankOf(minRole);
  return grants
    .filter((grant) => rankOf(grant.role) >= minRank)
    .map((grant) => ({
      prefix: grant.prefix,
      exclude: restricted.filter(
        (r) => prefixCovers(grant.prefix, r) && !prefixCovers(r, grant.prefix),
      ),
    }));
}

export function pathInScopes(scopes: PathScope[], path: string): boolean {
  return scopes.some(
    (s) =>
      prefixCovers(s.prefix, path) &&
      !s.exclude.some((e) => prefixCovers(e, path)),
  );
}

// Intersect two scope sets (OR-of-intervals each). `b === null` means the second
// set is unrestricted (an admin caller), so the result is just `a`. Used to fence
// the in-app agent test chat to `agentScopes ∩ callerScopes`, so the test surface
// can never reveal more than the caller could read directly. Two intervals
// intersect to the narrower prefix when one covers the other, and not at all when
// they're disjoint; excludes are unioned (an exclude from either side still cuts).
export function intersectScopes(
  a: PathScope[],
  b: PathScope[] | null,
): PathScope[] {
  if (b === null) return a;
  const out: PathScope[] = [];
  for (const x of a) {
    for (const y of b) {
      let prefix: string | null = null;
      if (prefixCovers(x.prefix, y.prefix)) prefix = y.prefix;
      else if (prefixCovers(y.prefix, x.prefix)) prefix = x.prefix;
      if (prefix === null) continue;
      out.push({ prefix, exclude: [...x.exclude, ...y.exclude] });
    }
  }
  return out;
}
