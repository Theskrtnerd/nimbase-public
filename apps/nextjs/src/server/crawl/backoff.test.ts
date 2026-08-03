import { describe, expect, it } from "vitest";

import {
  backoffSeconds,
  MAX_CONSECUTIVE_FAILURES,
  nextRunAfterFailure,
  nextRunAfterSuccess,
  shouldPark,
} from "./backoff";

describe("backoffSeconds", () => {
  it("returns the plain interval with no failures", () => {
    expect(backoffSeconds(3600, 0)).toBe(3600);
  });

  it("grows exponentially with the failure count", () => {
    expect(backoffSeconds(60, 1)).toBe(120);
    expect(backoffSeconds(60, 2)).toBe(240);
    expect(backoffSeconds(60, 3)).toBe(480);
  });

  it("caps at 6h", () => {
    expect(backoffSeconds(3600, 10)).toBe(6 * 60 * 60);
  });
});

describe("nextRun helpers", () => {
  const now = new Date("2026-07-07T00:00:00Z");

  it("schedules success one interval out", () => {
    expect(nextRunAfterSuccess(now, 3600).toISOString()).toBe(
      "2026-07-07T01:00:00.000Z",
    );
  });

  it("schedules failure with backoff applied", () => {
    // 60s interval, 2 failures → 240s.
    expect(nextRunAfterFailure(now, 60, 2).toISOString()).toBe(
      "2026-07-07T00:04:00.000Z",
    );
  });
});

describe("shouldPark", () => {
  it("parks once the max streak is reached", () => {
    expect(shouldPark(MAX_CONSECUTIVE_FAILURES - 1)).toBe(false);
    expect(shouldPark(MAX_CONSECUTIVE_FAILURES)).toBe(true);
  });
});
