import { describe, expect, it, vi } from "vitest";

import { groupMcpCreateInput } from "./group-mcp";

vi.mock("@acme/db/client", () => ({ db: {} }));

describe("groupMcpCreateInput", () => {
  it("accepts a kebab slug and known tools", () => {
    const v = groupMcpCreateInput.parse({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      slug: "design",
      name: "Design",
      instructions: "Design specs and brand.",
      folderPath: "design",
      tools: ["search", "get_note"],
      authMethods: ["api_key", "oauth"],
    });
    expect(v.slug).toBe("design");
  });
  it("rejects a reserved slug", () => {
    expect(() =>
      groupMcpCreateInput.parse({
        workspaceId: "00000000-0000-4000-8000-000000000001",
        slug: "api",
        name: "x",
        instructions: "y",
        folderPath: "x",
        tools: ["search"],
        authMethods: ["api_key"],
      }),
    ).toThrow();
  });
});
