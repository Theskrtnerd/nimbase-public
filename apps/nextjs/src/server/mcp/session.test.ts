import { describe, expect, it } from "vitest";

const { createMcpCaller, mcpSession } = await import("./session");

describe("mcpSession", () => {
  it("shapes a tRPC session from a userId", () => {
    expect(mcpSession("user_123")).toEqual({
      user: { id: "user_123", name: null, email: null },
    });
  });
});

describe("createMcpCaller", () => {
  it("returns a caller exposing the knowledge-base routers", () => {
    const caller = createMcpCaller("user_123");
    expect(typeof caller.workspace.all).toBe("function");
    expect(typeof caller.kb.search).toBe("function");
    expect(typeof caller.kb.getNode).toBe("function");
    expect(typeof caller.sources.list).toBe("function");
  });
});
