import { describe, expect, it } from "vitest";

import type { ResolvedAccessLike } from "./context";
import type { Capability } from "./provider";
import { toProviderContext } from "./context";
import { assertOpToolset, hasCapability, OP_TOOLSET } from "./provider";

function accessWithToolsets(
  read: boolean,
  capture: boolean,
): ResolvedAccessLike {
  return {
    workspaceId: "ws_1",
    userId: "user_1",
    scopes: (minRole) => {
      if (minRole === "viewer") return read ? null : [];
      if (minRole === "contributor") return capture ? null : [];
      return [];
    },
  };
}

describe("OP_TOOLSET", () => {
  it("maps every capability to a toolset (reads→read, writes→capture)", () => {
    expect(OP_TOOLSET).toEqual({
      search: "read",
      fetch: "read",
      neighbors: "read",
      provenance: "read",
      upsert: "capture",
      link: "capture",
      reconcile: "capture",
    });
  });
});

describe("assertOpToolset", () => {
  it("gates read ops on the read toolset", () => {
    const ctx = toProviderContext(accessWithToolsets(true, false));
    expect(() => assertOpToolset(ctx, "search")).not.toThrow();
    expect(() => assertOpToolset(ctx, "upsert")).toThrow();
  });

  it("gates write ops on the capture toolset", () => {
    const ctx = toProviderContext(accessWithToolsets(true, true));
    expect(() => assertOpToolset(ctx, "upsert")).not.toThrow();
  });
});

describe("hasCapability", () => {
  it("reflects the provider's advertised capability set", () => {
    // The wiki/Postgres provider ships without `link` (no edge table yet).
    const caps: Capability[] = [
      "search",
      "fetch",
      "neighbors",
      "upsert",
      "reconcile",
      "provenance",
    ];
    const provider = {
      capabilities: new Set(caps),
    };
    expect(hasCapability(provider, "search")).toBe(true);
    expect(hasCapability(provider, "link")).toBe(false);
  });
});
