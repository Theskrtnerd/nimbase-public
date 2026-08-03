import { afterEach, describe, expect, it, vi } from "vitest";

import { PLAN_LIMITS, resolveEntitlements } from "./entitlements";

vi.mock("@acme/db/client", () => ({ db: {} }));

const originalEdition = process.env.NIMBASE_EDITION;

afterEach(() => {
  if (originalEdition === undefined) {
    delete process.env.NIMBASE_EDITION;
  } else {
    process.env.NIMBASE_EDITION = originalEdition;
  }
});

describe("widget entitlements", () => {
  it("free plan gets no widgets", () => {
    expect(PLAN_LIMITS.free.widgets).toBe(0);
  });
  it("pro plan gets 5 widgets", () => {
    expect(PLAN_LIMITS.pro.widgets).toBe(5);
  });
  it("enterprise is unlimited", () => {
    expect(PLAN_LIMITS.enterprise.widgets).toBe(Infinity);
  });
});

describe("community entitlements", () => {
  it("unlocks the complete self-hosted product without a billing database row", async () => {
    process.env.NIMBASE_EDITION = "community";

    await expect(resolveEntitlements("workspace-1")).resolves.toMatchObject({
      plan: "enterprise",
      status: null,
      limits: PLAN_LIMITS.enterprise,
    });
  });
});
