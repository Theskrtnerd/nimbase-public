import { describe, expect, it } from "vitest";

import { chunkMarkdown } from "./chunk";

describe("chunkMarkdown", () => {
  it("returns no chunks for empty or whitespace input", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   \n\n  ")).toEqual([]);
  });

  it("returns a single chunk for a short note with no headings", () => {
    const chunks = chunkMarkdown("Just a short body.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ ord: 0, text: "Just a short body." });
  });

  it("prefixes chunks with their heading breadcrumb", () => {
    const md = "# Title\n\nIntro line.\n\n## Section\n\nDetail line.";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ ord: 0, text: "Title\n\nIntro line." });
    expect(chunks[1]).toEqual({
      ord: 1,
      text: "Title > Section\n\nDetail line.",
    });
  });

  it("splits a long section into multiple chunks under the size budget", () => {
    const para = "x".repeat(1500);
    const md = `# Big\n\n${para}\n\n${para}`;
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(2100);
    }
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
  });
});
