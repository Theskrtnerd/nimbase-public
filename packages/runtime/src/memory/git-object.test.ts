import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { createGitBlob, createGitCommit, createGitTrees } from "./git-object";

function inflated(object: { compressed: Uint8Array }): string {
  return inflateSync(object.compressed).toString("utf8");
}

describe("Git object encoding", () => {
  it("matches Git's canonical empty blob and tree ids", () => {
    expect(createGitBlob("").oid).toBe(
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    );
    expect(createGitTrees({}).rootOid).toBe(
      "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    );
  });

  it("builds nested trees containing standard blob entries", () => {
    const blob = createGitBlob("# Company\n");
    const result = createGitTrees({ "identity/company.md": blob.oid });
    expect(result.objects).toHaveLength(2);
    const [nestedTree, rootTree] = result.objects;
    if (!nestedTree || !rootTree) throw new Error("expected two tree objects");
    expect(inflated(nestedTree)).toContain("tree ");
    expect(inflated(rootTree)).toContain("tree ");
  });

  it("creates deterministic commits with a parent", () => {
    const input = {
      treeOid: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      parentOid: "0123456789012345678901234567890123456789",
      message: "Update company.md",
      createdAt: new Date("2026-08-06T00:00:00.000Z"),
    };
    const commit = createGitCommit(input);
    expect(inflated(commit)).toContain(
      "parent 0123456789012345678901234567890123456789",
    );
    expect(inflated(commit)).toContain("\n\nUpdate company.md\n");
    expect(createGitCommit(input).oid).toBe(commit.oid);
  });
});
