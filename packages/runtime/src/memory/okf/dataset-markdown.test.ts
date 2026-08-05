import { describe, expect, it } from "vitest";

import { datasetToMarkdown } from "./dataset-markdown";

describe("datasetToMarkdown", () => {
  it("renders an array of flat records as a markdown table", () => {
    const md = datasetToMarkdown([
      { name: "Starter", monthlyUsd: 99 },
      { name: "Growth", monthlyUsd: 499 },
    ]);
    expect(md).toBe(
      "| name | monthlyUsd |\n|---|---|\n| Starter | 99 |\n| Growth | 499 |\n",
    );
  });

  it("renders null/missing cells as empty and unions record keys", () => {
    const md = datasetToMarkdown([{ a: 1 }, { a: null, b: "x" }]);
    expect(md).toBe("| a | b |\n|---|---|\n| 1 |  |\n|  | x |\n");
  });

  it("falls back to a fenced json block for non-tabular data", () => {
    const md = datasetToMarkdown({ nested: { deep: true } });
    expect(md).toBe(
      '```json\n{\n  "nested": {\n    "deep": true\n  }\n}\n```\n',
    );
  });

  it("escapes pipes in cell values", () => {
    const md = datasetToMarkdown([{ a: "x|y" }]);
    expect(md).toContain("x\\|y");
  });
});
