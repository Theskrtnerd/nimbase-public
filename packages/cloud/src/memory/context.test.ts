import { describe, expect, it } from "vitest";

import type { PathScope } from "@acme/db";
import type { GrantRole } from "@acme/db/schema";

import type { ProviderAccessContext, ResolvedAccessLike } from "./context";
import {
  assertToolset,
  hasToolset,
  ToolsetForbiddenError,
  toProviderContext,
} from "./context";

// A fake resolved-access whose `scopes(minRole)` returns whatever the test
// wires per role — mirrors access.ts's `scopes: (minRole) => PathScope[] | null`.
function fakeAccess(
  perRole: Partial<Record<GrantRole, PathScope[] | null>>,
  overrides: Partial<ResolvedAccessLike> = {},
): ResolvedAccessLike {
  return {
    workspaceId: "ws_1",
    userId: "user_1",
    scopes: (minRole) => {
      const value = perRole[minRole];
      return value === undefined ? [] : value;
    },
    ...overrides,
  };
}

const prefix = (p: string): PathScope => ({ prefix: p, exclude: [] });

describe("toProviderContext", () => {
  it("derives all three toolsets for an admin (null scopes at every role)", () => {
    const ctx = toProviderContext(
      fakeAccess({ viewer: null, contributor: null, manager: null }),
    );
    expect([...ctx.allowedToolsets].sort()).toEqual([
      "admin",
      "capture",
      "read",
    ]);
  });

  it("derives read+capture but not admin for a contributor", () => {
    const ctx = toProviderContext(
      fakeAccess({
        viewer: [prefix("docs/")],
        contributor: [prefix("docs/")],
        manager: [],
      }),
    );
    expect(hasToolset(ctx, "read")).toBe(true);
    expect(hasToolset(ctx, "capture")).toBe(true);
    expect(hasToolset(ctx, "admin")).toBe(false);
  });

  it("withholds a toolset whose scopes are empty (no access)", () => {
    const ctx = toProviderContext(
      fakeAccess({ viewer: [prefix("a/")], contributor: [], manager: [] }),
    );
    expect(hasToolset(ctx, "read")).toBe(true);
    expect(hasToolset(ctx, "capture")).toBe(false);
  });

  it("carries per-toolset scope DATA for the provider to compile into SQL", () => {
    const viewerScopes = [prefix("docs/"), prefix("eng/")];
    const ctx = toProviderContext(
      fakeAccess({ viewer: viewerScopes, contributor: null, manager: [] }),
    );
    expect(ctx.scopes.read).toEqual(viewerScopes);
    expect(ctx.scopes.capture).toBeNull();
    expect(ctx.scopes.admin).toEqual([]);
  });

  it("maps principal + workspace and ships empty (unenforced) limits", () => {
    const ctx = toProviderContext(
      fakeAccess({}, { userId: "user_42", workspaceId: "ws_9" }),
    );
    expect(ctx.principalId).toBe("user_42");
    expect(ctx.workspaceId).toBe("ws_9");
    expect(ctx.limits).toEqual({});
  });

  it("keeps a null principalId for an anonymous access", () => {
    const ctx = toProviderContext(fakeAccess({}, { userId: null }));
    expect(ctx.principalId).toBeNull();
  });
});

describe("assertToolset", () => {
  it("passes when the toolset is present and throws otherwise", () => {
    const ctx = toProviderContext(fakeAccess({ viewer: null }));
    expect(() => assertToolset(ctx, "read")).not.toThrow();
    expect(() => assertToolset(ctx, "capture")).toThrow(ToolsetForbiddenError);
  });
});

describe("ProviderAccessContext branding", () => {
  it("cannot be hand-rolled (only toProviderContext constructs it)", () => {
    // @ts-expect-error — missing the module-private brand; not assignable.
    const bad: ProviderAccessContext = {
      principalId: "user_1",
      workspaceId: "ws_1",
      allowedToolsets: new Set(["read"]),
      scopes: { read: null, capture: null, admin: null },
      limits: {},
    };
    // Runtime object exists; the guarantee is the compile error above.
    expect(bad.workspaceId).toBe("ws_1");
  });
});
