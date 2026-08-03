// access.test.ts — DB-mocked tests for buildAccessContext + resolveAccess/requireAccess
// pathScopeWhere SQL tests live in access-sql.test.ts (no mocks needed).

import { describe, expect, it, vi } from "vitest";

import {
  anchoredContext,
  anchoredScopes,
  buildAccessContext,
  loadRestrictedPaths,
  requireAccess,
  resolveAccess,
} from "./access";

// ---------------------------------------------------------------------------
// DB mock — controls resolveAccess DB call sequence
// ---------------------------------------------------------------------------
// resolveAccess query sequence for non-admin member:
//   select[0]: WorkspaceMember (member row) → .where().limit()
//   (For admin short-circuit, only select[0] is called.)
//   select[1]: WorkspaceGroupMember  → .where() Promise
//   select[2]: WikiNode (restricted) → .where() Promise
//   select[3]: AccessGrant leftJoin WikiNode → .where() Promise

let selectCallIndex = 0;
let selectResults: unknown[][] = [];

function resetDb(results: unknown[][]) {
  selectCallIndex = 0;
  selectResults = results;
}

vi.mock("@acme/db/client", () => {
  return {
    db: {
      select: () => {
        const idx = selectCallIndex++;
        const rows = selectResults[idx] ?? [];
        const where = vi.fn(() => {
          const limitFn = vi.fn().mockResolvedValue(rows);
          const promise = Promise.resolve(rows);
          return Object.assign(promise, { limit: limitFn });
        });
        const leftJoin = vi.fn(() => ({ where }));
        const innerJoin = vi.fn(() => ({ where }));
        return { from: vi.fn(() => ({ where, innerJoin, leftJoin })) };
      },
    },
  };
});

vi.mock("@acme/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => [a, b]),
  inArray: vi.fn((a: unknown, b: unknown) => [a, b]),
  isNull: vi.fn((a: unknown) => a),
  or: vi.fn((...args: unknown[]) => args),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...params: unknown[]) => ({
      _tag: "sql",
      strings: Array.from(strings),
      params,
    }),
    {
      join: (chunks: unknown[], _sep?: unknown) => ({
        _tag: "sqlJoin",
        chunks,
      }),
    },
  ),
}));

vi.mock("@acme/db/schema", () => ({
  AccessGrant: {
    workspaceId: "ag.workspaceId",
    principalType: "ag.principalType",
    principalId: "ag.principalId",
    folderId: "ag.folderId",
    role: "ag.role",
  },
  WikiNode: {
    id: "wn.id",
    workspaceId: "wn.workspaceId",
    path: "wn.path",
    restricted: "wn.restricted",
    deletedAt: "wn.deletedAt",
  },
  UserProfile: {
    id: "up.id",
    workspaceId: "up.workspaceId",
    status: "up.status",
  },
  WorkspaceGroupMember: {
    groupId: "wgm.groupId",
    userId: "wgm.userId",
  },
  WorkspaceMember: {
    workspaceId: "wm.workspaceId",
    userId: "wm.userId",
    userProfileId: "wm.userProfileId",
    role: "wm.role",
  },
}));

// ---------------------------------------------------------------------------
// buildAccessContext — pure, no DB
// ---------------------------------------------------------------------------

describe("buildAccessContext", () => {
  it("owner: isAdmin true, canRead anything, scopes(viewer) === null", () => {
    const ctx = buildAccessContext({
      workspaceId: "ws1",
      userId: "u1",
      role: "owner",
      grants: [],
      restricted: [],
    });
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.canRead("any/path")).toBe(true);
    expect(ctx.canCapture("any/path")).toBe(true);
    expect(ctx.canManage("any/path")).toBe(true);
    expect(ctx.scopes("viewer")).toBeNull();
  });

  it("admin role also bypasses", () => {
    const ctx = buildAccessContext({
      workspaceId: "ws1",
      userId: "u1",
      role: "admin",
      grants: [],
      restricted: [],
    });
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.scopes("manager")).toBeNull();
  });

  it("(c) member with viewer grant on live folder: canRead inside true, outside false", () => {
    const ctx = buildAccessContext({
      workspaceId: "ws1",
      userId: "u1",
      role: "member",
      grants: [{ prefix: "eng", role: "viewer" }],
      restricted: [],
    });
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.canRead("eng/api")).toBe(true);
    expect(ctx.canRead("eng")).toBe(true);
    expect(ctx.canRead("sales/docs")).toBe(false);
    expect(ctx.canCapture("eng/api")).toBe(false); // viewer < contributor
    expect(ctx.scopes("viewer")).toEqual([{ prefix: "eng", exclude: [] }]);
  });

  it("member with contributor grant: canCapture true inside, false outside", () => {
    const ctx = buildAccessContext({
      workspaceId: "ws1",
      userId: "u1",
      role: "member",
      grants: [{ prefix: "sales", role: "contributor" }],
      restricted: [],
    });
    expect(ctx.canCapture("sales/deals")).toBe(true);
    expect(ctx.canCapture("eng")).toBe(false);
    expect(ctx.canManage("sales/deals")).toBe(false);
  });

  it("restricted boundary: root grant blocked by restricted folder", () => {
    const ctx = buildAccessContext({
      workspaceId: "ws1",
      userId: "u1",
      role: "member",
      grants: [{ prefix: "", role: "viewer" }],
      restricted: ["leadership"],
    });
    expect(ctx.canRead("eng/api")).toBe(true);
    expect(ctx.canRead("leadership/comp")).toBe(false);
    const scopes = ctx.scopes("viewer");
    expect(scopes).toEqual([{ prefix: "", exclude: ["leadership"] }]);
  });

  it("(d) grant on soft-deleted folder is dropped (empty grants → no access)", () => {
    // resolveAccess flatMap drops rows with folderDeletedAt !== null.
    // Here we verify that if grants is empty (already filtered), canRead is false.
    const ctx = buildAccessContext({
      workspaceId: "ws1",
      userId: "u1",
      role: "member",
      grants: [],
      restricted: [],
    });
    expect(ctx.canRead("eng/api")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAccess (a) + (b) — minimal DB interaction
// ---------------------------------------------------------------------------

describe("resolveAccess", () => {
  // Type-narrowing guard: throws (failing the test) instead of `!` assertions.
  function expectContext(
    ctx: Awaited<ReturnType<typeof resolveAccess>>,
  ): NonNullable<Awaited<ReturnType<typeof resolveAccess>>> {
    if (!ctx) throw new Error("expected an access context, got null");
    return ctx;
  }

  it("(a) returns null when no member row", async () => {
    resetDb([[]]);
    const result = await resolveAccess("u1", "ws1");
    expect(result).toBeNull();
  });

  it("(b) admin member (owner): isAdmin true, scopes === null", async () => {
    resetDb([[{ role: "owner", userProfileId: "profile-1" }]]);
    const result = expectContext(await resolveAccess("u1", "ws1"));
    expect(result.isAdmin).toBe(true);
    expect(result.scopes("viewer")).toBeNull();
    expect(result.canRead("anything")).toBe(true);
    expect(result.userProfileId).toBe("profile-1");
  });

  it("(b) admin member (admin role): isAdmin true", async () => {
    resetDb([[{ role: "admin", userProfileId: "profile-1" }]]);
    const result = await resolveAccess("u1", "ws1");
    expect(result?.isAdmin).toBe(true);
  });

  it("(c) non-admin member: grant rows map to ResolvedGrants (live folder → path, null folder → root)", async () => {
    resetDb([
      [{ role: "member", userProfileId: "profile-1" }], // select[0]: WorkspaceMember
      [], // select[1]: WorkspaceGroupMember (no groups)
      [], // select[2]: WikiNode restricted (none)
      [
        // select[3]: AccessGrant leftJoin WikiNode
        {
          role: "viewer",
          folderId: "f1",
          folderPath: "eng",
          folderDeletedAt: null,
        },
        {
          role: "contributor",
          folderId: null,
          folderPath: null,
          folderDeletedAt: null,
        },
      ],
    ]);
    const result = expectContext(await resolveAccess("u1", "ws1"));
    expect(result.isAdmin).toBe(false);
    expect(result.grants).toEqual(
      expect.arrayContaining([
        { prefix: "eng", role: "viewer" },
        { prefix: "", role: "contributor" },
      ]),
    );
    expect(result.grants).toHaveLength(2);
    expect(result.canRead("eng/x")).toBe(true);
  });

  it("(d) grant on soft-deleted folder is dropped by the row mapping", async () => {
    resetDb([
      [{ role: "member", userProfileId: "profile-1" }], // select[0]: WorkspaceMember
      [], // select[1]: WorkspaceGroupMember
      [], // select[2]: WikiNode restricted
      [
        // select[3]: live path string present, but folder is soft-deleted → dropped
        {
          role: "viewer",
          folderId: "f1",
          folderPath: "eng",
          folderDeletedAt: new Date(),
        },
      ],
    ]);
    const result = expectContext(await resolveAccess("u1", "ws1"));
    expect(result.grants).toEqual([]);
    expect(result.canRead("eng/x")).toBe(false);
  });
});

describe("requireAccess", () => {
  it("(a) throws TRPCError NOT_FOUND when no member row", async () => {
    resetDb([[]]);
    await expect(requireAccess("u1", "ws1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// A deployment anchor — one grant, restricted-bounded, fail closed.
// These cases cover the anchored scope used by agent interface grants.
// ---------------------------------------------------------------------------

describe("anchoredScopes", () => {
  it("builds a single viewer scope on the deployment folder", () => {
    expect(anchoredScopes("customers", [])).toEqual([
      { prefix: "customers", exclude: [] },
    ]);
  });

  it("excludes restricted descendants inside the fence, ignores ones outside", () => {
    expect(
      anchoredScopes("customers", ["customers/secret", "elsewhere/private"]),
    ).toEqual([
      {
        prefix: "customers",
        exclude: ["customers/secret"],
      },
    ]);
  });

  it("does not exclude the (restricted) anchor folder itself", () => {
    expect(anchoredScopes("customers", ["customers"])).toEqual([
      { prefix: "customers", exclude: [] },
    ]);
  });

  it("null fails closed while an empty path means workspace root", () => {
    expect(anchoredScopes(null, [])).toEqual([]);
    expect(anchoredScopes("", [])).toEqual([{ prefix: "", exclude: [] }]);
  });

  it("contributor anchor still yields a read scope", () => {
    expect(anchoredScopes("customers", [], "contributor")).toEqual([
      { prefix: "customers", exclude: [] },
    ]);
  });
});

describe("anchoredContext", () => {
  it("member-role context with exactly one grant fenced to the folder", () => {
    const ctx = anchoredContext({
      workspaceId: "ws1",
      userId: "u1",
      folderPath: "support",
      role: "viewer",
      restricted: [],
    });
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.role).toBe("member");
    expect(ctx.grants).toEqual([{ prefix: "support", role: "viewer" }]);
    expect(ctx.canRead("support/faq")).toBe(true);
    expect(ctx.canRead("elsewhere")).toBe(false);
    expect(ctx.canCapture("support/faq")).toBe(false); // viewer
  });

  it("contributor role can capture inside the fence but never manage", () => {
    const ctx = anchoredContext({
      workspaceId: "ws1",
      userId: null,
      folderPath: "support",
      role: "contributor",
      restricted: [],
    });
    expect(ctx.userId).toBeNull(); // api-key principals have no user
    expect(ctx.canCapture("support/faq")).toBe(true);
    expect(ctx.canManage("support/faq")).toBe(false);
  });

  it("restricted descendants inside the anchor stay fenced off", () => {
    const ctx = anchoredContext({
      workspaceId: "ws1",
      userId: "u1",
      folderPath: "support",
      role: "viewer",
      restricted: ["support/private"],
    });
    expect(ctx.canRead("support/faq")).toBe(true);
    expect(ctx.canRead("support/private/notes")).toBe(false);
  });
});

describe("loadRestrictedPaths", () => {
  it("returns the workspace's restricted folder paths", async () => {
    resetDb([[{ path: "leadership" }, { path: "customers" }]]);
    await expect(loadRestrictedPaths("ws1")).resolves.toEqual([
      "leadership",
      "customers",
    ]);
  });

  it("empty when nothing is restricted", async () => {
    resetDb([[]]);
    await expect(loadRestrictedPaths("ws1")).resolves.toEqual([]);
  });
});
