import type { PathScope, SQL } from "@acme/db";
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  pathScopeMatchSql,
  sql,
} from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode, WikiNodeVersion } from "@acme/db/schema";

import type { GraphInputNote } from "./knowledge-graph";
import * as s3 from "./s3";

// Cap on notes pulled into a single graph build — bounds S3 reads and keeps
// the force layout / neighbor derivation interactive. The single source of
// truth for both the kb.graph tRPC procedure and the MemoryProvider.
export const MAX_GRAPH_NODES = 2000;

// SQL scope filter over a wiki_node path column. Mirrors `pathScopeWhere` in
// packages/api/src/lib/access.ts exactly so callers filter by path scope
// SQL-side (memory-kernel decision #4 — never a JS predicate in the read path):
//   null  → unrestricted (admin) → no filter
//   []    → no access → FALSE
//   [...] → the shared LIKE-prefix match (same escaping as the access layer)
export function scopeWhere(
  pathExpr: SQL | { getSQL(): SQL },
  scopes: PathScope[] | null,
): SQL | undefined {
  if (scopes === null) return undefined;
  if (scopes.length === 0) return sql`false`;
  return pathScopeMatchSql(pathExpr, scopes);
}

// Scan the workspace's readable compiled notes and load their S3 bodies into
// GraphInputNotes ready for `buildKnowledgeGraph`. Shared verbatim by the
// kb.graph tRPC procedure and the MemoryProvider's `neighbors` op so the query,
// the MAX_GRAPH_NODES cap, and the degrade-on-unreadable-body fan-out live once.
// `scopes` is the caller's viewer path scopes (`access.scopes("viewer")` /
// `ctx.scopes.read`). `truncated` reports whether the cap was hit; callers that
// need the scanned count read `inputs.length`.
export async function scanReadableGraphInputs(
  workspaceId: string,
  scopes: PathScope[] | null,
): Promise<{ inputs: GraphInputNote[]; truncated: boolean }> {
  // Fetch one past the cap so we can report truncation.
  const rows = await db
    .select({
      id: WikiNode.id,
      path: WikiNode.path,
      title: WikiNode.title,
      s3Key: WikiNodeVersion.s3Key,
    })
    .from(WikiNode)
    .innerJoin(
      WikiNodeVersion,
      eq(WikiNodeVersion.id, WikiNode.currentVersionId),
    )
    .where(
      and(
        eq(WikiNode.workspaceId, workspaceId),
        isNotNull(WikiNode.currentVersionId),
        isNull(WikiNode.deletedAt),
        scopeWhere(WikiNode.path, scopes),
      ),
    )
    .orderBy(desc(WikiNode.createdAt))
    .limit(MAX_GRAPH_NODES + 1);

  const truncated = rows.length > MAX_GRAPH_NODES;
  const limited = truncated ? rows.slice(0, MAX_GRAPH_NODES) : rows;

  // A single unreadable body shouldn't sink the whole graph — degrade that
  // note to an edge-less node.
  const bodies = await Promise.all(
    limited.map(async (row) => {
      try {
        return await s3.getObjectText(row.s3Key);
      } catch {
        return "";
      }
    }),
  );

  const inputs: GraphInputNote[] = limited.map((row, i) => ({
    nodeId: row.id,
    path: row.path,
    title: row.title,
    body: bodies[i] ?? "",
  }));

  return { inputs, truncated };
}
