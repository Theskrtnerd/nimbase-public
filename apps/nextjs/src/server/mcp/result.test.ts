import { describe, expect, it } from "vitest";

import { errorResult, jsonResult, toErrorMessage } from "./result";

describe("jsonResult", () => {
  it("combines a summary line with pretty JSON", () => {
    const r = jsonResult("1 result", { a: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]?.text).toContain("1 result");
    expect(r.content[0]?.text).toContain('"a": 1');
  });
});

describe("errorResult", () => {
  it("flags isError", () => {
    const r = errorResult("nope");
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("nope");
  });
});

describe("toErrorMessage", () => {
  it("adds a hint for unknown workspaces", () => {
    expect(toErrorMessage(new Error("Workspace not found"))).toContain(
      "list_workspaces",
    );
  });
  it("adds a hint for unknown notes", () => {
    expect(toErrorMessage(new Error("Note not found"))).toContain("search");
  });
  it("passes through other messages", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });
  it("handles non-Error throws", () => {
    expect(toErrorMessage("weird")).toBe("Unknown error");
  });
});
