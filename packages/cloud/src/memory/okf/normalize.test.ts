import { describe, expect, it } from "vitest";

import { normalizeTag, normalizeTags, normalizeTitle } from "./normalize";

describe("normalizeTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeTitle("  My   Note \n")).toBe("My Note");
  });

  it("returns null for empty/whitespace-only titles", () => {
    expect(normalizeTitle("")).toBeNull();
    expect(normalizeTitle("   ")).toBeNull();
  });

  it("caps length at 120 characters", () => {
    const long = "x".repeat(200);
    expect(normalizeTitle(long)?.length).toBe(120);
  });
});

describe("normalizeTag", () => {
  it("kebab-cases and strips invalid characters", () => {
    expect(normalizeTag("  My Tag!  ")).toBe("my-tag");
    expect(normalizeTag("A__B")).toBe("ab");
    expect(normalizeTag("--x--")).toBe("x");
  });

  it("returns null when nothing survives", () => {
    expect(normalizeTag("!!!")).toBeNull();
    expect(normalizeTag("")).toBeNull();
  });
});

describe("normalizeTags", () => {
  it("normalizes, dedupes, and caps at 12", () => {
    expect(normalizeTags(["A", "a", "B tag"])).toEqual(["a", "b-tag"]);
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(12);
  });
});
