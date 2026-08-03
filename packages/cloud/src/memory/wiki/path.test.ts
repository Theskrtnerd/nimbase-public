import { describe, expect, it } from "vitest";

import { kebabSegmentError, noteLeafError } from "./path";

describe("kebabSegmentError", () => {
  it("accepts lowercase kebab-case segments", () => {
    expect(kebabSegmentError("projects/nimbase/compile-pipeline")).toBeNull();
    expect(kebabSegmentError("a")).toBeNull();
    expect(kebabSegmentError("a1-b2")).toBeNull();
  });

  it("rejects uppercase letters", () => {
    expect(kebabSegmentError("Projects/nimbase")).not.toBeNull();
  });

  it("rejects spaces", () => {
    expect(kebabSegmentError("projects/my note")).not.toBeNull();
  });

  it("rejects underscores", () => {
    expect(kebabSegmentError("projects/my_note")).not.toBeNull();
  });

  it("rejects leading, trailing, or doubled hyphens", () => {
    expect(kebabSegmentError("-leading")).not.toBeNull();
    expect(kebabSegmentError("trailing-")).not.toBeNull();
    expect(kebabSegmentError("double--hyphen")).not.toBeNull();
  });

  it("ignores empty segments from leading/trailing/double slashes", () => {
    expect(kebabSegmentError("/projects/nimbase/")).toBeNull();
    expect(kebabSegmentError("projects//nimbase")).toBeNull();
  });

  it("accepts an empty string (a bare leaf with no folder prefix)", () => {
    expect(kebabSegmentError("")).toBeNull();
  });

  it("names the offending segment in the error message", () => {
    expect(kebabSegmentError("projects/Bad Segment/x")).toContain(
      "Bad Segment",
    );
  });
});

describe("noteLeafError", () => {
  it("accepts a kebab-case leaf ending in .md", () => {
    expect(noteLeafError("projects/nimbase/compile-pipeline.md")).toBeNull();
    expect(noteLeafError("note.md")).toBeNull();
  });

  it("rejects a missing .md extension", () => {
    expect(noteLeafError("projects/nimbase/compile-pipeline")).not.toBeNull();
  });

  it("rejects a non-kebab-case stem even with .md", () => {
    expect(noteLeafError("projects/My_Note.md")).not.toBeNull();
    expect(noteLeafError("projects/My Note.md")).not.toBeNull();
  });

  it("rejects the wrong extension", () => {
    expect(noteLeafError("projects/compile-pipeline.mdx")).not.toBeNull();
    expect(noteLeafError("projects/compile-pipeline.txt")).not.toBeNull();
  });

  it("only validates the last path segment", () => {
    expect(noteLeafError("Weird Folder/compile-pipeline.md")).toBeNull();
  });
});
