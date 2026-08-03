import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  isZipSource,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  selectZipEntries,
} from "./zip-entries";

const utf8 = (text: string) => new TextEncoder().encode(text);

function makeZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {};
  for (const [path, body] of Object.entries(files)) {
    encoded[path] = typeof body === "string" ? utf8(body) : body;
  }
  return zipSync(encoded);
}

describe("isZipSource", () => {
  const file = (mimeType: string | null, originalFilename: string | null) =>
    isZipSource({ kind: "file", mimeType, originalFilename });

  it("detects every zip mime variant browsers send", () => {
    expect(file("application/zip", null)).toBe(true);
    expect(file("application/x-zip-compressed", null)).toBe(true);
    expect(file("multipart/x-zip", null)).toBe(true);
  });

  it("falls back to the filename when the mime is missing or generic", () => {
    expect(file(null, "export.zip")).toBe(true);
    expect(file("application/octet-stream", "Export.ZIP")).toBe(true);
  });

  it("does not treat an ordinary document as an archive", () => {
    expect(file("text/markdown", "notes.md")).toBe(false);
    // "zip" appearing anywhere but the extension must not match.
    expect(file("text/plain", "zipline-notes.txt")).toBe(false);
  });

  it("only ever fires for the file kind", () => {
    const base = { mimeType: "application/zip", originalFilename: "a.zip" };
    expect(isZipSource({ kind: "file", ...base })).toBe(true);
    // A screenshot/voice/video row can't be an archive, whatever it claims.
    expect(isZipSource({ kind: "screenshot", ...base })).toBe(false);
  });
});

describe("selectZipEntries", () => {
  it("selects real files and assigns a mime from the extension", () => {
    const { entries, skipped } = selectZipEntries(
      makeZip({
        "handbook.md": "# Handbook",
        "docs/pricing.csv": "plan,price",
        "data.json": "{}",
      }),
    );

    expect(skipped).toEqual([]);
    expect(entries.map((e) => e.path)).toEqual([
      "data.json",
      "docs/pricing.csv",
      "handbook.md",
    ]);
    expect(entries.map((e) => e.mimeType)).toEqual([
      "application/json",
      "text/csv",
      "text/markdown",
    ]);
  });

  it("returns entries in sorted order so a truncating cap is deterministic", () => {
    const { entries } = selectZipEntries(
      makeZip({ "c.md": "c", "a.md": "a", "b.md": "b" }),
    );
    expect(entries.map((e) => e.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("drops junk paths silently, without listing them as skipped", () => {
    const { entries, skipped } = selectZipEntries(
      makeZip({
        "keep.md": "keep",
        "__MACOSX/._keep.md": "resource fork",
        ".DS_Store": "junk",
        ".env": "SECRET=1",
        "node_modules/pkg/index.js": "code",
        ".git/config": "gitdir",
        "dist/bundle.js": "built",
      }),
    );

    expect(entries.map((e) => e.path)).toEqual(["keep.md"]);
    // Junk is uninteresting noise — reporting it would bury the real skips.
    expect(skipped).toEqual([]);
  });

  it("gives an unknown extension a generic mime rather than dropping it", () => {
    const { entries } = selectZipEntries(makeZip({ "diagram.sketch": "x" }));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.mimeType).toBe("application/octet-stream");
    expect(entries[0]?.ext).toBe("sketch");
  });

  it("skips empty files and reports them", () => {
    const { entries, skipped } = selectZipEntries(
      makeZip({ "empty.md": "", "real.md": "content" }),
    );
    expect(entries.map((e) => e.path)).toEqual(["real.md"]);
    expect(skipped).toEqual(["empty.md — empty file"]);
  });

  it("skips an entry over the per-entry byte cap", () => {
    const { entries, skipped } = selectZipEntries(
      makeZip({
        "huge.txt": new Uint8Array(MAX_ENTRY_BYTES + 1),
        "small.md": "ok",
      }),
    );
    expect(entries.map((e) => e.path)).toEqual(["small.md"]);
    expect(skipped[0]).toContain("huge.txt");
    expect(skipped[0]).toContain("larger than");
  });

  it("does not recurse into a nested archive", () => {
    const inner = makeZip({ "inner.md": "inner" });
    const { entries, skipped } = selectZipEntries(
      makeZip({ "outer.md": "outer", "nested.zip": inner }),
    );

    expect(entries.map((e) => e.path)).toEqual(["outer.md"]);
    expect(skipped).toEqual(["nested.zip — nested archives are not expanded"]);
  });

  it("caps the entry count and reports the overflow", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      files[`note-${String(i).padStart(4, "0")}.md`] = `note ${i}`;
    }

    const { entries, skipped } = selectZipEntries(makeZip(files));
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(skipped).toHaveLength(5);
    expect(skipped[0]).toContain(`exceeds ${MAX_ENTRIES} files`);
  });

  it("ignores directory entries", () => {
    const { entries } = selectZipEntries(
      makeZip({ "docs/": "", "docs/a.md": "a" }),
    );
    expect(entries.map((e) => e.path)).toEqual(["docs/a.md"]);
  });

  it("handles an empty archive", () => {
    expect(selectZipEntries(makeZip({}))).toEqual({
      entries: [],
      skipped: [],
    });
  });
});
