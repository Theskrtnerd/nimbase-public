import { describe, expect, it } from "vitest";

import { groupMcpRewritePath } from "./proxy";

const APP = "nimbase.ai";

describe("groupMcpRewritePath", () => {
  it("rewrites an mcp-subdomain URL to the path route", () => {
    expect(groupMcpRewritePath("mcp.nimbase.ai", "/acme/design/mcp", APP)).toBe(
      "/api/group-mcp/acme/design",
    );
  });
  it("tolerates a trailing slash", () => {
    expect(
      groupMcpRewritePath("mcp.nimbase.ai", "/acme/design/mcp/", APP),
    ).toBe("/api/group-mcp/acme/design");
  });
  it("ignores the apex, app, and other hosts", () => {
    expect(
      groupMcpRewritePath("nimbase.ai", "/acme/design/mcp", APP),
    ).toBeNull();
    expect(
      groupMcpRewritePath("app.nimbase.ai", "/acme/design/mcp", APP),
    ).toBeNull();
    expect(
      groupMcpRewritePath("acme.nimbase.ai", "/design/mcp", APP),
    ).toBeNull();
  });
  it("rejects a spoofed suffix host", () => {
    expect(
      groupMcpRewritePath(
        "mcp.nimbase.ai.attacker.com",
        "/acme/design/mcp",
        APP,
      ),
    ).toBeNull();
  });
  it("requires the trailing /mcp segment", () => {
    expect(
      groupMcpRewritePath("mcp.nimbase.ai", "/acme/design", APP),
    ).toBeNull();
  });
  it("requires both org and group segments", () => {
    expect(groupMcpRewritePath("mcp.nimbase.ai", "/mcp", APP)).toBeNull();
    expect(
      groupMcpRewritePath("mcp.nimbase.ai", "/design/mcp", APP),
    ).toBeNull();
  });
});
