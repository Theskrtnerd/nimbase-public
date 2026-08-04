import { describe, expect, it } from "vitest";

import { COMMUNITY_LIMITS, resolveEntitlements } from "./entitlements";

describe("community entitlements", () => {
  it("unlocks the complete self-hosted product without billing state", async () => {
    await expect(resolveEntitlements("workspace-1")).resolves.toEqual({
      plan: "enterprise",
      status: null,
      limits: COMMUNITY_LIMITS,
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });
});
