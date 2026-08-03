import { describe, expect, it } from "vitest";

import {
  GROUP_MCP_TOOLS,
  groupMcpNeedsWriteRole,
  groupMcpToolSchema,
  mcpAuthMethodSchema,
} from "./schema";

describe("group MCP schema constants", () => {
  it("lists the exposable tools", () => {
    expect(GROUP_MCP_TOOLS).toEqual([
      "search",
      "get_note",
      "list_sources",
      "capture",
      "create_artifact",
    ]);
  });
  it("asks for a write role only when a write tool is exposed", () => {
    expect(groupMcpNeedsWriteRole(["search", "get_note"])).toBe(false);
    expect(groupMcpNeedsWriteRole(["search", "capture"])).toBe(true);
    // Artifact authoring files a page into the anchor folder, so it needs the
    // same contributor role capture does.
    expect(groupMcpNeedsWriteRole(["search", "create_artifact"])).toBe(true);
  });
  it("validates a tool name", () => {
    expect(groupMcpToolSchema.parse("search")).toBe("search");
    expect(() => groupMcpToolSchema.parse("delete_everything")).toThrow();
  });
  it("validates an auth method", () => {
    expect(mcpAuthMethodSchema.parse("api_key")).toBe("api_key");
    expect(mcpAuthMethodSchema.parse("oauth")).toBe("oauth");
    expect(() => mcpAuthMethodSchema.parse("basic")).toThrow();
  });
});
