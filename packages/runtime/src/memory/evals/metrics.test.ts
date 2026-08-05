import { describe, expect, it } from "vitest";

import { aggregate, scoreQuery, stableRanking } from "./metrics";

describe("scoreQuery", () => {
  it("recall@k counts relevant ids within the top k over the relevant-set size", () => {
    const s = scoreQuery(["a", "x", "b", "y"], ["a", "b", "c"], 5);
    // a and b are in the top 5; c is missing → 2/3.
    expect(s.recallAtK).toBeCloseTo(2 / 3);
  });

  it("recall@k respects the cutoff (a relevant id past k does not count)", () => {
    const s = scoreQuery(["x", "y", "z", "a"], ["a"], 3);
    expect(s.recallAtK).toBe(0);
  });

  it("reciprocal rank is 1/(1-based rank) of the first relevant id", () => {
    expect(scoreQuery(["x", "a", "b"], ["a"], 5).reciprocalRank).toBe(1 / 2);
    expect(scoreQuery(["a"], ["a"], 5).reciprocalRank).toBe(1);
  });

  it("reciprocal rank is 0 when no relevant id is retrieved", () => {
    expect(scoreQuery(["x", "y"], ["a"], 5).reciprocalRank).toBe(0);
  });
});

describe("aggregate", () => {
  it("averages recall@k and reciprocal rank across queries", () => {
    const agg = aggregate([
      { recallAtK: 1, reciprocalRank: 1 },
      { recallAtK: 0, reciprocalRank: 0 },
    ]);
    expect(agg.recallAtK).toBe(0.5);
    expect(agg.mrr).toBe(0.5);
    expect(agg.queries).toBe(2);
  });
});

describe("stableRanking", () => {
  it("orders by score desc then node id, so equal scores are deterministic", () => {
    const ranking = stableRanking([
      { nodeId: "b", score: 0.5 },
      { nodeId: "a", score: 0.5 },
      { nodeId: "c", score: 0.9 },
    ]);
    expect(ranking).toEqual(["c", "a", "b"]);
  });
});
