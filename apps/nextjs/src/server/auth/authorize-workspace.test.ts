import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@acme/api/access";

import { verifySessionToken } from "~/lib/desktop-auth";
import { verifyApiToken } from "./api-token";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
  authzErrorTextResponse,
} from "./authorize-workspace";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(() => ({})) }));
vi.mock("~/lib/desktop-auth", () => ({ verifySessionToken: vi.fn() }));
vi.mock("./api-token", () => ({ verifyApiToken: vi.fn() }));
vi.mock("@acme/api/access", () => ({
  resolveAccess: vi.fn(),
  buildAccessContext: vi.fn(),
}));
// authorizeApiToken reads restricted paths before returning; the token cases
// here only care about which workspace it resolves to, so the scope query is
// stubbed to "no restricted folders".
vi.mock("@acme/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";

function sessionRequest(): Request {
  return new Request("https://app.nimbase.ai/api/notes/x", {
    headers: { authorization: "Bearer session-token" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: not an ApiToken, so every case below exercises the user-session
  // branch unless it says otherwise.
  vi.mocked(verifyApiToken).mockResolvedValue(null);
});

describe("authorizeWorkspaceRequest failure reasons", () => {
  it("reports unauthenticated when no credential resolves", async () => {
    vi.mocked(verifySessionToken).mockReturnValue(null);

    const result = await authorizeWorkspaceRequest(sessionRequest(), WORKSPACE);

    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
  });

  // The bug this whole distinction exists for: a good session pointed at a
  // workspace the user is not a member of must NOT read as "log in again".
  it("reports forbidden when a real user cannot access the workspace", async () => {
    vi.mocked(verifySessionToken).mockReturnValue({ userId: "user_1" });
    vi.mocked(resolveAccess).mockResolvedValue(null);

    const result = await authorizeWorkspaceRequest(sessionRequest(), WORKSPACE);

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("reports workspace_required when a real user names no workspace", async () => {
    vi.mocked(verifySessionToken).mockReturnValue({ userId: "user_1" });

    const result = await authorizeWorkspaceRequest(sessionRequest(), undefined);

    expect(result).toEqual({ ok: false, reason: "workspace_required" });
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it("authorizes a member and spreads the workspace onto the result", async () => {
    const access = { workspaceId: WORKSPACE, role: "owner" };
    vi.mocked(verifySessionToken).mockReturnValue({ userId: "user_1" });
    vi.mocked(resolveAccess).mockResolvedValue(
      access as unknown as Awaited<ReturnType<typeof resolveAccess>>,
    );

    const result = await authorizeWorkspaceRequest(sessionRequest(), WORKSPACE);

    expect(result).toMatchObject({
      ok: true,
      workspaceId: WORKSPACE,
      userId: "user_1",
      access,
    });
  });

  // A token is a valid credential, so aiming it elsewhere is authz, not authn —
  // and it must never silently fall back to the token's own workspace.
  it("reports forbidden for a valid token aimed at another workspace", async () => {
    vi.mocked(verifyApiToken).mockResolvedValue({
      workspaceId: WORKSPACE,
      role: "viewer",
      folderId: null,
    } as unknown as Awaited<ReturnType<typeof verifyApiToken>>);

    const result = await authorizeWorkspaceRequest(
      sessionRequest(),
      OTHER_WORKSPACE,
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("authz error responses", () => {
  it("maps each reason to its status and code", async () => {
    const cases = [
      {
        reason: "unauthenticated" as const,
        status: 401,
        error: "unauthorized",
      },
      { reason: "forbidden" as const, status: 403, error: "forbidden" },
      {
        reason: "workspace_required" as const,
        status: 400,
        error: "workspace_required",
      },
    ];
    for (const { reason, status, error } of cases) {
      const res = authzErrorResponse({ reason });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error });
    }
  });

  it("keeps the same statuses on the plain-text variant", () => {
    expect(authzErrorTextResponse({ reason: "unauthenticated" }).status).toBe(
      401,
    );
    expect(authzErrorTextResponse({ reason: "forbidden" }).status).toBe(403);
  });
});
