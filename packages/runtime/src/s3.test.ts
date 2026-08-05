import { describe, expect, it } from "vitest";

import { s3KeyFor } from "./s3";

describe("s3KeyFor", () => {
  it("builds a tenant-prefixed original source key", () => {
    expect(s3KeyFor.originalSource("ws1", "src1", "html")).toBe(
      "workspaces/ws1/sources/src1/original.html",
    );
  });
  it("builds a wiki body key", () => {
    expect(s3KeyFor.wikiBody("ws1", "ver1")).toBe(
      "workspaces/ws1/wiki/ver1.md",
    );
  });
  it("builds a share html key", () => {
    expect(s3KeyFor.shareHtml("ws1", "slug1")).toBe(
      "workspaces/ws1/shares/slug1.html",
    );
  });
  it("builds a artifact html key", () => {
    expect(s3KeyFor.artifactHtml("ws1", "id1")).toBe(
      "workspaces/ws1/artifactes/id1.html",
    );
  });
  it("builds the raw.md source key", () => {
    expect(s3KeyFor.rawMdSource("ws1", "src1")).toBe(
      "workspaces/ws1/sources/src1/raw.md",
    );
  });
  it("builds a artifact source key", () => {
    expect(s3KeyFor.artifactSource("ws1", "id1")).toBe(
      "workspaces/ws1/artifactes/id1.tsx",
    );
  });
});
