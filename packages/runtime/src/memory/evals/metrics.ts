// Retrieval metrics for the eval — pure, dependency-free so they unit-test in
// the default (fast) suite without a DB. A "ranking" is the ordered list of node
// ids a query returned (best first); "relevant" is the judged set of node ids
// that SHOULD be retrieved for that query.

export interface QueryScore {
  // recall@k: fraction of the relevant ids that appear in the top-k results.
  recallAtK: number;
  // Reciprocal rank of the FIRST relevant id (1-based); 0 if none appears.
  reciprocalRank: number;
}

export interface AggregateScore {
  // Mean recall@k across all scored queries.
  recallAtK: number;
  // Mean reciprocal rank across all scored queries (MRR).
  mrr: number;
  queries: number;
}

// Score one query's ranking against its relevant set at cutoff k.
export function scoreQuery(
  ranking: readonly string[],
  relevant: readonly string[],
  k: number,
): QueryScore {
  const relevantSet = new Set(relevant);
  if (relevantSet.size === 0) {
    // No judgment → nothing to measure; treat as a perfect, inert score so it
    // never drags the aggregate (callers should not pass empty relevant sets).
    return { recallAtK: 1, reciprocalRank: 1 };
  }

  const topK = ranking.slice(0, k);
  let hits = 0;
  for (const id of topK) if (relevantSet.has(id)) hits++;
  const recallAtK = hits / relevantSet.size;

  let reciprocalRank = 0;
  for (let i = 0; i < ranking.length; i++) {
    const id = ranking[i];
    if (id !== undefined && relevantSet.has(id)) {
      reciprocalRank = 1 / (i + 1);
      break;
    }
  }

  return { recallAtK, reciprocalRank };
}

// Mean recall@k and MRR over a set of scored queries.
export function aggregate(scores: readonly QueryScore[]): AggregateScore {
  if (scores.length === 0) return { recallAtK: 0, mrr: 0, queries: 0 };
  let recall = 0;
  let rr = 0;
  for (const s of scores) {
    recall += s.recallAtK;
    rr += s.reciprocalRank;
  }
  return {
    recallAtK: recall / scores.length,
    mrr: rr / scores.length,
    queries: scores.length,
  };
}

// Stable ranking from scored hits: descending score, ties broken by node id so
// two runs over the same data produce the same ranking (Postgres leaves equal
// ORDER BY score rows unordered). This is eval-side determinism, not a change to
// production search ordering.
export function stableRanking(
  hits: readonly { nodeId: string; score: number }[],
): string[] {
  return [...hits]
    .sort((a, b) => b.score - a.score || (a.nodeId < b.nodeId ? -1 : 1))
    .map((h) => h.nodeId);
}
