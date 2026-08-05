import { describe, expect, it } from "vitest";

import { createGitBlob } from "./git-object";
import { applyMemoryChanges } from "./git-projection";

describe("memory mutation replay", () => {
  it("applies content, subtree moves, and subtree deletes in order", () => {
    const original = createGitBlob("old").oid;
    const result = applyMemoryChanges(
      { "projects/old.md": original, "keep.md": original },
      [
        { type: "upsert", path: "projects/new.md", versionId: "v2" },
        { type: "move", from: "projects", to: "archive/projects" },
        { type: "delete", path: "archive/projects/old.md" },
      ],
      new Map([["v2", "body:v2"]]),
    );

    expect(result.entries).toEqual({
      "archive/projects/new.md": createGitBlob("body:v2").oid,
      "keep.md": original,
    });
    expect(result.blobs).toHaveLength(1);
  });

  it("rejects a move that would overwrite another memory path", () => {
    const oid = createGitBlob("body").oid;
    expect(() =>
      applyMemoryChanges(
        { "from/note.md": oid, "to/note.md": oid },
        [{ type: "move", from: "from", to: "to" }],
        new Map(),
      ),
    ).toThrow("collides");
  });
});
