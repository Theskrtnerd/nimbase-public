import { describe, expect, it } from "vitest";

import {
  isReservedSlug,
  nextAvailableSlug,
  randomSlugSuffix,
  resourceSlugBase,
  slugifyName,
} from "./slug";

// Deterministic suffix source so slug tests don't depend on randomness.
// Yields the given tokens in order, then throws if exhausted.
function suffixes(...tokens: string[]): () => string {
  let i = 0;
  return () => {
    const token = tokens[i++];
    if (token === undefined) throw new Error("ran out of test suffixes");
    return token;
  };
}

describe("slugifyName", () => {
  it("kebab-cases and strips punctuation", () => {
    expect(slugifyName("Acme Corp!")).toBe("acme-corp");
    expect(slugifyName("  Design   Team  ")).toBe("design-team");
    expect(slugifyName("R&D / 2026")).toBe("r-d-2026");
  });
  it("collapses repeats and trims dashes", () => {
    expect(slugifyName("--Hello--World--")).toBe("hello-world");
  });
  it("returns empty string when nothing survives", () => {
    expect(slugifyName("!!!")).toBe("");
  });
});

describe("resourceSlugBase", () => {
  it("reserves room for a collision suffix within the 64-character contract", () => {
    const base = resourceSlugBase("A".repeat(100), "artifact");
    expect(base).toHaveLength(57);
    expect(`${base}-qkzrmf`).toHaveLength(64);
  });

  it("uses the fallback when the name has no slug characters", () => {
    expect(resourceSlugBase("!!!", "artifact")).toBe("artifact");
  });
});

describe("isReservedSlug", () => {
  it("flags platform words", () => {
    expect(isReservedSlug("app")).toBe(true);
    expect(isReservedSlug("MCP")).toBe(true);
    expect(isReservedSlug("design")).toBe(false);
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base when nothing is taken", () => {
    expect(nextAvailableSlug("design", new Set())).toBe("design");
  });
  it("appends a random-letter suffix when the base is taken", () => {
    expect(
      nextAvailableSlug("design", new Set(["design"]), suffixes("qkzr")),
    ).toBe("design-qkzr");
  });
  it("re-rolls the suffix until an untaken one lands", () => {
    expect(
      nextAvailableSlug(
        "design",
        new Set(["design", "design-qkzr"]),
        suffixes("qkzr", "fwtp"),
      ),
    ).toBe("design-fwtp");
  });
  it("skips a reserved base even with an empty taken set", () => {
    expect(nextAvailableSlug("app", new Set(), suffixes("qkzr"))).toBe(
      "app-qkzr",
    );
  });
});

describe("randomSlugSuffix", () => {
  it("is six lowercase letters with no digits", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomSlugSuffix()).toMatch(/^[a-z]{6}$/);
    }
  });
});
