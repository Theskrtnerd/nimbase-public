import { describe, expect, it } from "vitest";

import { mergeSourceRows } from "./node-metadata-merge";

const row = (
  id: string,
  overrides: Partial<{
    kind: string;
    title: string | null;
    sourceUrl: string | null;
    capturedAt: Date | null;
    createdAt: Date;
  }> = {},
) => ({
  id,
  kind: "web",
  title: null,
  sourceUrl: null,
  capturedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("mergeSourceRows", () => {
  it("dedups by source id, keeping the first occurrence's fields", () => {
    const rows = [
      row("s1", { title: "First" }),
      row("s1", { title: "Second" }),
    ];
    const merged = mergeSourceRows(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("First");
  });

  it("sorts newest capturedAt first", () => {
    const rows = [
      row("old", { capturedAt: new Date("2026-01-01T00:00:00Z") }),
      row("new", { capturedAt: new Date("2026-06-01T00:00:00Z") }),
      row("mid", { capturedAt: new Date("2026-03-01T00:00:00Z") }),
    ];
    expect(mergeSourceRows(rows).map((r) => r.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("falls back to createdAt when capturedAt is null", () => {
    const rows = [
      row("no-capture", {
        capturedAt: null,
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
      row("captured", {
        capturedAt: new Date("2026-02-01T00:00:00Z"),
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ];
    // no-capture's createdAt (May) outranks captured's capturedAt (Feb).
    expect(mergeSourceRows(rows).map((r) => r.id)).toEqual([
      "no-capture",
      "captured",
    ]);
  });

  it("merges rows from both the version-history and explicit-citation sources", () => {
    const versionRows = [row("from-version")];
    const citedRows = [row("from-citation")];
    const merged = mergeSourceRows([...versionRows, ...citedRows]);
    expect(merged.map((r) => r.id).sort()).toEqual([
      "from-citation",
      "from-version",
    ]);
  });

  it("a source appearing in both version history and citations is deduped", () => {
    const merged = mergeSourceRows([
      row("shared", { capturedAt: new Date("2026-01-01T00:00:00Z") }),
      row("shared", { capturedAt: new Date("2026-06-01T00:00:00Z") }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("returns an empty array for no rows", () => {
    expect(mergeSourceRows([])).toEqual([]);
  });
});
