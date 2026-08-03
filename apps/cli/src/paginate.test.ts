import { describe, expect, it, vi } from "vitest";

import { collectAllPages } from "./paginate";

describe("collectAllPages", () => {
  it("walks every page and threads the cursor through", async () => {
    const pages = new Map<
      string | undefined,
      {
        items: string[];
        nextCursor: string | null;
      }
    >([
      [undefined, { items: ["a"], nextCursor: "c1" }],
      ["c1", { items: ["b"], nextCursor: "c2" }],
      ["c2", { items: ["c"], nextCursor: null }],
    ]);
    const seenCursors: (string | undefined)[] = [];

    const result = await collectAllPages((cursor) => {
      seenCursors.push(cursor);
      const page = pages.get(cursor);
      if (!page) throw new Error(`unexpected cursor: ${String(cursor)}`);
      return Promise.resolve(page);
    });

    expect(result).toEqual(["a", "b", "c"]);
    expect(seenCursors).toEqual([undefined, "c1", "c2"]);
  });

  // An older server that doesn't send nextCursor must not loop forever.
  it("treats an absent nextCursor as the last page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ items: ["a"], nextCursor: undefined });

    const result = await collectAllPages(fetchPage);

    expect(result).toEqual(["a"]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ items: ["a"], nextCursor: "stuck" });

    await expect(collectAllPages(fetchPage)).rejects.toThrow(
      "Server returned a repeated pagination cursor",
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
