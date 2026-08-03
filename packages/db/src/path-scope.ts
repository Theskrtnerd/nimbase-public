import type { SQL } from "drizzle-orm/sql";
import { sql } from "drizzle-orm/sql";

// Path-scope primitives shared by the access layer (pathScopeWhere) and search
// (searchScopeSql). They live here, the lowest shared package, because cloud
// cannot depend on api — so the LIKE-escaping and the filter SQL have exactly
// one definition and cannot silently drift between the two call sites.

// A readable subtree: an allowed prefix minus the restricted subtree prefixes
// carved out of it. "" = workspace root.
export interface PathScope {
  prefix: string;
  exclude: string[];
}

// SQL LIKE treats % and _ as wildcards. Folder names are user/LLM-supplied, so
// every prefix interpolated into a LIKE pattern must be escaped, and the query
// must declare ESCAPE '\'.
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// True when `pathExpr` is at-or-under `prefix` ("" covers everything). pathExpr
// is any path-valued SQL expression — a column (WikiNode.path) or a raw alias
// (sql`n.path`).
export function pathCoverSql(
  pathExpr: SQL | { getSQL(): SQL },
  prefix: string,
): SQL {
  return prefix === ""
    ? sql`true`
    : sql`(${pathExpr} = ${prefix} OR ${pathExpr} LIKE ${`${escapeLikePrefix(prefix)}/%`} ESCAPE '\\')`;
}

// OR of each scope's prefix cover, each minus its excluded restricted subtrees.
// Assumes a non-empty scope list; callers decide what empty/unrestricted mean.
export function pathScopeMatchSql(
  pathExpr: SQL | { getSQL(): SQL },
  scopes: PathScope[],
): SQL {
  const parts = scopes.map((scope) => {
    const allow = pathCoverSql(pathExpr, scope.prefix);
    if (scope.exclude.length === 0) return allow;
    const excludes = scope.exclude.map(
      (e) => sql`NOT ${pathCoverSql(pathExpr, e)}`,
    );
    return sql`(${allow} AND ${sql.join(excludes, sql` AND `)})`;
  });
  return sql`(${sql.join(parts, sql` OR `)})`;
}
