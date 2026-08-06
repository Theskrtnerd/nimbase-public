import { describe, expect, it } from "vitest";

import { firstSyncPollInterval } from "./connection-polling";

describe("firstSyncPollInterval", () => {
  it("polls while an active connection is waiting for its first completed sync", () => {
    expect(
      firstSyncPollInterval([
        { status: "active", lastSuccessAt: null },
        { status: "active", lastSuccessAt: new Date() },
      ]),
    ).toBe(2000);
  });

  it("stops polling once no active connection is waiting", () => {
    expect(
      firstSyncPollInterval([
        { status: "active", lastSuccessAt: new Date() },
        { status: "paused", lastSuccessAt: null },
      ]),
    ).toBe(false);
  });
});
