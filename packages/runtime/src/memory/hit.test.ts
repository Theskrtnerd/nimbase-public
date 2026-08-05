import { describe, expect, it } from "vitest";

import type { MemorySearchResult } from "./provider";
import { toSearchHit } from "./hit";

describe("toSearchHit", () => {
  it("projects a MemorySearchResult to the flat search-hit wire shape", () => {
    const result: MemorySearchResult = {
      node: {
        id: "n1",
        kind: "note",
        title: "Q3 plan",
        content: "…the best matching snippet…",
        metadata: { path: "sales/q3" },
        labels: ["sales"],
        sources: [],
      },
      score: 0.42,
    };

    expect(toSearchHit(result)).toEqual({
      nodeId: "n1",
      path: "sales/q3",
      title: "Q3 plan",
      snippet: "…the best matching snippet…",
      score: 0.42,
    });
  });
});
