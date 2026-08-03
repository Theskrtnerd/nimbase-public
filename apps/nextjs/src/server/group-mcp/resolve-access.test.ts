import { describe, expect, it, vi } from "vitest";

import type * as AcmeApiAccess from "@acme/api/access";
import { resolveAccess } from "@acme/api/access";

import type { GroupMcpEndpoint } from "./resolve-access";
import { authorizeApiToken } from "~/server/auth/authorize-workspace";
import { resolveGroupMcpAccess } from "./resolve-access";

vi.mock("~/server/auth/authorize-workspace", () => ({
  authorizeApiToken: vi.fn(),
}));
vi.mock("@acme/api/access", async (orig) => {
  const actual = await orig<typeof AcmeApiAccess>();
  return { ...actual, resolveAccess: vi.fn() };
});

const endpoint: GroupMcpEndpoint = {
  workspaceId: "ws-1",
  deploymentId: "mcp-1",
  folderId: "folder-1",
  folderPath: "design",
  tools: ["search", "get_note"],
  authMethods: ["api_key", "oauth"],
  artifactVisibility: "private",
};

describe("resolveGroupMcpAccess — API key", () => {
  it("admits a token scoped to (or under) the deployment folder", async () => {
    vi.mocked(authorizeApiToken).mockResolvedValue({
      workspaceId: "ws-1",
      userId: null,
      apiToken: { id: "token-1", groupMcpId: "mcp-1" },
      access: {
        workspaceId: "ws-1",
        canRead: (p: string) => p === "design" || p.startsWith("design/"),
        restricted: [],
      } as never,
    });
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: "Bearer tok",
      clerkUserId: null,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a token from another workspace", async () => {
    vi.mocked(authorizeApiToken).mockResolvedValue({
      workspaceId: "ws-OTHER",
      userId: null,
      apiToken: { id: "token-1", groupMcpId: "mcp-1" },
      access: {
        workspaceId: "ws-OTHER",
        canRead: () => true,
        restricted: [],
      } as never,
    });
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: "Bearer tok",
      clerkUserId: null,
    });
    expect(r).toEqual({ ok: false, status: 403 });
  });

  it("rejects a token minted for another MCP deployment", async () => {
    vi.mocked(authorizeApiToken).mockResolvedValue({
      workspaceId: "ws-1",
      userId: null,
      apiToken: { id: "token-1", groupMcpId: "mcp-other" },
      access: {
        workspaceId: "ws-1",
        canRead: () => true,
        restricted: [],
      } as never,
    });
    const result = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: "Bearer tok",
      clerkUserId: null,
    });
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("401s when neither credential is present", async () => {
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: null,
      clerkUserId: null,
    });
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it("blocks a restricted child folder inside the endpoint anchor (inner-restricted regression)", async () => {
    // The anchor folder "design" is broadly readable, but "design/legal" is
    // itself a restricted child. The fenced context must carry the token's
    // real restricted set, not just the anchor, or the child leaks through.
    vi.mocked(authorizeApiToken).mockResolvedValue({
      workspaceId: "ws-1",
      userId: null,
      apiToken: { id: "token-1", groupMcpId: "mcp-1" },
      access: {
        workspaceId: "ws-1",
        canRead: (p: string) => p === "design" || p.startsWith("design/"),
        canCapture: () => false,
        restricted: ["design", "design/legal"],
      } as never,
    });
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: "Bearer tok",
      clerkUserId: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.access.canRead("design/legal")).toBe(false);
      expect(r.access.canRead("design")).toBe(true);
    }
  });

  it("fences a parent-scoped token so it cannot leak sibling folders (sibling-leak regression)", async () => {
    // A token scoped broadly to "docs" (a parent of the endpoint folder
    // "docs/team-a") can also read the sibling "docs/team-b". The endpoint
    // for team-a must NOT return access that can read team-b.
    vi.mocked(authorizeApiToken).mockResolvedValue({
      workspaceId: "ws-1",
      userId: null,
      apiToken: { id: "token-1", groupMcpId: "mcp-1" },
      access: {
        workspaceId: "ws-1",
        canRead: (p: string) =>
          p === "docs" || p === "docs/team-a" || p === "docs/team-b",
        canCapture: () => false,
        restricted: [],
      } as never,
    });
    const teamAEndpoint: GroupMcpEndpoint = {
      ...endpoint,
      folderPath: "docs/team-a",
    };
    const r = await resolveGroupMcpAccess({
      endpoint: teamAEndpoint,
      authorizationHeader: "Bearer tok",
      clerkUserId: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.access.canRead("docs/team-b")).toBe(false);
      expect(r.access.canRead("docs/team-a")).toBe(true);
    }
  });

  it("grants contributor when the endpoint exposes capture and the token can capture", async () => {
    vi.mocked(authorizeApiToken).mockResolvedValue({
      workspaceId: "ws-1",
      userId: null,
      apiToken: { id: "token-1", groupMcpId: "mcp-1" },
      access: {
        workspaceId: "ws-1",
        canRead: () => true,
        canCapture: () => true,
        restricted: [],
      } as never,
    });
    const captureEndpoint: GroupMcpEndpoint = {
      ...endpoint,
      tools: ["search", "get_note", "capture"],
    };
    const r = await resolveGroupMcpAccess({
      endpoint: captureEndpoint,
      authorizationHeader: "Bearer tok",
      clerkUserId: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.access.canCapture(endpoint.folderPath)).toBe(true);
  });

  it("caps to viewer when the endpoint does not expose capture, even if the token could capture", async () => {
    vi.mocked(authorizeApiToken).mockResolvedValue({
      workspaceId: "ws-1",
      userId: null,
      apiToken: { id: "token-1", groupMcpId: "mcp-1" },
      access: {
        workspaceId: "ws-1",
        canRead: () => true,
        canCapture: () => true,
        restricted: [],
      } as never,
    });
    const r = await resolveGroupMcpAccess({
      endpoint, // tools: ["search", "get_note"] — no capture
      authorizationHeader: "Bearer tok",
      clerkUserId: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.access.canCapture(endpoint.folderPath)).toBe(false);
  });
});

describe("resolveGroupMcpAccess — OAuth member", () => {
  it("403s a member who cannot read the folder", async () => {
    vi.mocked(resolveAccess).mockResolvedValue({
      workspaceId: "ws-1",
      role: "member",
      canRead: () => false,
      canCapture: () => false,
      restricted: [],
    } as never);
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: null,
      clerkUserId: "user-1",
    });
    expect(r).toEqual({ ok: false, status: 403 });
  });

  it("admits a member who can read, scoped to the folder", async () => {
    vi.mocked(resolveAccess).mockResolvedValue({
      workspaceId: "ws-1",
      role: "member",
      canRead: (p: string) => p === "design",
      canCapture: () => false,
      restricted: [],
    } as never);
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: null,
      clerkUserId: "user-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.access.canRead("design")).toBe(true);
  });

  it("403s OAuth when the endpoint disallows oauth", async () => {
    const r = await resolveGroupMcpAccess({
      endpoint: { ...endpoint, authMethods: ["api_key"] },
      authorizationHeader: null,
      clerkUserId: "user-1",
    });
    expect(r).toEqual({ ok: false, status: 403 });
  });

  it("caps to viewer when the endpoint exposes capture but the member cannot capture", async () => {
    vi.mocked(resolveAccess).mockResolvedValue({
      workspaceId: "ws-1",
      role: "member",
      canRead: () => true,
      canCapture: () => false,
      restricted: [],
    } as never);
    const captureEndpoint: GroupMcpEndpoint = {
      ...endpoint,
      tools: ["search", "get_note", "capture"],
    };
    const r = await resolveGroupMcpAccess({
      endpoint: captureEndpoint,
      authorizationHeader: null,
      clerkUserId: "user-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.access.canCapture(endpoint.folderPath)).toBe(false);
  });

  it("caps to viewer when the member can capture but the endpoint does not expose capture", async () => {
    vi.mocked(resolveAccess).mockResolvedValue({
      workspaceId: "ws-1",
      role: "member",
      canRead: () => true,
      canCapture: () => true,
      restricted: [],
    } as never);
    const r = await resolveGroupMcpAccess({
      endpoint, // tools: ["search", "get_note"] — no capture
      authorizationHeader: null,
      clerkUserId: "user-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.access.canCapture(endpoint.folderPath)).toBe(false);
  });

  it("fences the admitted member's access to the deployment folder (no sibling reads)", async () => {
    vi.mocked(resolveAccess).mockResolvedValue({
      workspaceId: "ws-1",
      role: "member",
      canRead: (p: string) => p === "design" || p === "other-folder",
      canCapture: () => false,
      restricted: [],
    } as never);
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: null,
      clerkUserId: "user-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.access.canRead("design")).toBe(true);
      expect(r.access.canRead("other-folder")).toBe(false);
    }
  });

  it("falls through to OAuth when the Bearer token isn't a valid ApiToken (Clerk token on a both-methods endpoint)", async () => {
    // A Clerk OAuth token also arrives as `Authorization: Bearer <token>`.
    // On an endpoint allowing both api_key and oauth, authorizeApiToken
    // correctly returns null for it (not an ApiToken) — that must NOT
    // hard-401; it must fall through and let the OAuth path admit the
    // member. Before the fix this returned {ok:false, status:401}.
    vi.mocked(authorizeApiToken).mockResolvedValue(null);
    vi.mocked(resolveAccess).mockResolvedValue({
      workspaceId: "ws-1",
      role: "member",
      canRead: (p: string) => p === "design",
      canCapture: () => false,
      restricted: [],
    } as never);
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: "Bearer clerk-tok",
      clerkUserId: "user-1",
    });
    expect(r.ok).toBe(true);
  });

  it("refuses when the Bearer token isn't a valid ApiToken and there's no OAuth user", async () => {
    vi.mocked(authorizeApiToken).mockResolvedValue(null);
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: "Bearer bad",
      clerkUserId: null,
    });
    expect(r.ok).toBe(false);
  });

  it("blocks a restricted child folder inside the endpoint anchor (inner-restricted regression)", async () => {
    // The anchor folder "design" is broadly readable, but "design/legal" is
    // itself a restricted child. The fenced context must carry the caller's
    // real restricted set, not just the anchor, or the child leaks through.
    vi.mocked(resolveAccess).mockResolvedValue({
      workspaceId: "ws-1",
      role: "member",
      canRead: (p: string) => p === "design" || p.startsWith("design/"),
      canCapture: () => false,
      restricted: ["design", "design/legal"],
    } as never);
    const r = await resolveGroupMcpAccess({
      endpoint,
      authorizationHeader: null,
      clerkUserId: "user-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.access.canRead("design/legal")).toBe(false);
      expect(r.access.canRead("design")).toBe(true);
    }
  });
});
