import { describe, expect, it } from "vitest";

import { costFor } from "./cost";

describe("costFor", () => {
  it("prices claude sonnet at 300/1500 cents per MTok", () => {
    expect(
      costFor("anthropic/claude-sonnet-4.6", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(1800);
  });

  it("bills embeddings on input only", () => {
    expect(
      costFor("openai/text-embedding-3-small", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(2);
  });

  it("returns 0 for an unknown model", () => {
    expect(
      costFor("nope/nope", { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(0);
  });
});
