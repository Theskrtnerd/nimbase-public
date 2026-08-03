import type { PathScope } from "@acme/db";
import { pathScopeMatchSql, sql } from "@acme/db";
import { db } from "@acme/db/client";

import { embedQuery } from "./embed";

export interface SearchHit {
  nodeId: string;
  path: string;
  title: string;
  snippet: string;
  score: number;
}

interface SearchRow extends Record<string, unknown> {
  node_id: string;
  path: string;
  title: string;
  snippet: string | null;
  score: number;
}

// The readable-subtree shape, shared with the access layer (@acme/db). Kept as
// a named export here for callers that import it from @acme/cloud/search.
export type SearchScope = PathScope;

// Path filter over the already-joined wiki_node alias `n`, applied inside both
// retrieval legs so ranking happens AFTER permission filtering. Delegates to
// the shared pathScopeMatchSql builder (@acme/db) — the same one the access
// layer uses, so LIKE-escaping cannot drift.
// undefined scopes = unrestricted (admin / legacy callers).
/** exported for tests */
export function searchScopeSql(scopes: SearchScope[] | undefined) {
  if (scopes === undefined) return sql`true`;
  if (scopes.length === 0) return sql`false`;
  return pathScopeMatchSql(sql`n.path`, scopes);
}

const RRF_K = 60;
const CANDIDATES = 50;

// Relevance floor for the vector leg. pgvector KNN always returns the nearest
// neighbours, so without a cutoff a gibberish/unrelated query still surfaces
// the closest note. Calibrated against text-embedding-3-small cosine distance:
// genuine semantic matches measured 0.27–0.65, gibberish/unrelated 0.85–0.98 —
// 0.75 sits in the gap (max margin). Exact-keyword queries that embed poorly
// are still caught by the keyword leg, so dropping them here is harmless. Tune
// if recall feels too tight/loose.
const MAX_COSINE_DISTANCE = 0.75;

// ts_headline options: no markup so snippets are plain text and safe to render
// without dangerouslySetInnerHTML. StartSel/StopSel MUST be quoted empty
// strings — unquoted (`StartSel=,`) makes Postgres treat the comma as the
// marker and inject literal commas around matches.
const HEADLINE_OPTS =
  'StartSel="", StopSel="", MaxFragments=1, MaxWords=20, MinWords=8';

type ScopeSqlResult = ReturnType<typeof searchScopeSql>;

// Hybrid: vector (HNSW cosine) + keyword (functional GIN tsvector), fused with
// RRF, collapsed to one row per note (best chunk wins).
function hybridQuery(
  workspaceId: string,
  query: string,
  vecLiteral: string,
  scope: ScopeSqlResult,
) {
  return sql`
    WITH semantic AS (
      SELECT c.id,
             row_number() OVER (ORDER BY c.embedding <=> ${vecLiteral}::vector) AS rank
      FROM wiki_chunk c
      JOIN wiki_node_version v ON v.id = c.node_version_id
      JOIN wiki_node n ON n.id = v.node_id AND n.current_version_id = v.id
      WHERE c.workspace_id = ${workspaceId}
        AND n.deleted_at IS NULL
        AND c.embedding <=> ${vecLiteral}::vector < ${MAX_COSINE_DISTANCE}
        AND ${scope}
      ORDER BY c.embedding <=> ${vecLiteral}::vector
      LIMIT ${CANDIDATES}
    ),
    keyword AS (
      SELECT c.id,
             row_number() OVER (
               ORDER BY ts_rank_cd(to_tsvector('english', c.text),
                                   websearch_to_tsquery('english', ${query})) DESC
             ) AS rank
      FROM wiki_chunk c
      JOIN wiki_node_version v ON v.id = c.node_version_id
      JOIN wiki_node n ON n.id = v.node_id AND n.current_version_id = v.id
      WHERE c.workspace_id = ${workspaceId}
        AND n.deleted_at IS NULL
        AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', ${query})
        AND ${scope}
      LIMIT ${CANDIDATES}
    ),
    fused AS (
      SELECT COALESCE(s.id, k.id) AS chunk_id,
             COALESCE(1.0 / (${RRF_K} + s.rank), 0) +
             COALESCE(1.0 / (${RRF_K} + k.rank), 0) AS score
      FROM semantic s FULL OUTER JOIN keyword k USING (id)
    )
    SELECT n.id AS node_id, n.path, n.title, max(f.score) AS score,
           (array_agg(
              ts_headline('english', c.text,
                          websearch_to_tsquery('english', ${query}), ${HEADLINE_OPTS})
              ORDER BY f.score DESC))[1] AS snippet
    FROM fused f
    JOIN wiki_chunk c ON c.id = f.chunk_id
    JOIN wiki_node_version v ON v.id = c.node_version_id
    JOIN wiki_node n ON n.id = v.node_id
    GROUP BY n.id, n.path, n.title
    ORDER BY score DESC
  `;
}

// Keyword-only fallback (used when query embedding fails).
function keywordQuery(
  workspaceId: string,
  query: string,
  scope: ScopeSqlResult,
) {
  return sql`
    WITH keyword AS (
      SELECT c.id, c.text,
             ts_rank_cd(to_tsvector('english', c.text),
                        websearch_to_tsquery('english', ${query})) AS score
      FROM wiki_chunk c
      JOIN wiki_node_version v ON v.id = c.node_version_id
      JOIN wiki_node n ON n.id = v.node_id AND n.current_version_id = v.id
      WHERE c.workspace_id = ${workspaceId}
        AND n.deleted_at IS NULL
        AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', ${query})
        AND ${scope}
    )
    SELECT n.id AS node_id, n.path, n.title, max(k.score) AS score,
           (array_agg(
              ts_headline('english', k.text,
                          websearch_to_tsquery('english', ${query}), ${HEADLINE_OPTS})
              ORDER BY k.score DESC))[1] AS snippet
    FROM keyword k
    JOIN wiki_chunk c ON c.id = k.id
    JOIN wiki_node_version v ON v.id = c.node_version_id
    JOIN wiki_node n ON n.id = v.node_id
    GROUP BY n.id, n.path, n.title
    ORDER BY score DESC
  `;
}

// Rerank seam — identity in v1. Drop-in point for a future reranker.
function rerank(hits: SearchHit[]): SearchHit[] {
  return hits;
}

export async function searchWorkspace(args: {
  workspaceId: string;
  query: string;
  limit?: number;
  scopes?: SearchScope[];
}): Promise<SearchHit[]> {
  const query = args.query.trim();
  if (!query) return [];
  const limit = args.limit ?? 20;

  const scope = searchScopeSql(args.scopes);

  const vec = await embedQuery(query);
  const built = vec
    ? hybridQuery(args.workspaceId, query, `[${vec.join(",")}]`, scope)
    : keywordQuery(args.workspaceId, query, scope);

  const statement = sql`${built} LIMIT ${limit}`;
  const result = await db.execute<SearchRow>(statement);
  const rows: SearchRow[] = result.rows;

  const hits: SearchHit[] = rows.map((r) => ({
    nodeId: r.node_id,
    path: r.path,
    title: r.title,
    snippet: (r.snippet ?? "").trim(),
    score: Number(r.score),
  }));
  return rerank(hits).slice(0, limit);
}
