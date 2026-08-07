import { describe, expect, it } from "vitest";

import {
  accountPortalSignInUrl,
  groupMcpRewritePath,
  isDisabledProductUi,
} from "./proxy";

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

describe("isDisabledProductUi", () => {
  it.each([
    "/",
    "/dashboard",
    "/dashboard/workspaces/acme",
    "/onboarding/workspace",
    "/login",
    "/sign-up/verify",
    "/admin/workspaces",
  ])("disables %s", (pathname) => {
    expect(isDisabledProductUi(pathname)).toBe(true);
  });

  it.each([
    "/api/workspaces",
    "/desktop/authorize",
    "/widget/public-key",
    "/s/share",
  ])("keeps the machine or deployment surface %s", (pathname) => {
    expect(isDisabledProductUi(pathname)).toBe(false);
  });
});

describe("accountPortalSignInUrl", () => {
  it("sends authentication to Clerk and returns to the CLI callback", () => {
    expect(
      accountPortalSignInUrl(
        "https://accounts.nimbase.ai",
        "https://app.nimbase.ai/desktop/authorize?state=state-1",
      ).toString(),
    ).toBe(
      "https://accounts.nimbase.ai/sign-in?redirect_url=https%3A%2F%2Fapp.nimbase.ai%2Fdesktop%2Fauthorize%3Fstate%3Dstate-1",
    );
  });
});
