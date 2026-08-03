import { describe, expect, it, vi } from "vitest";

import { clampMessages, evaluateGates } from "./gates";

vi.mock("@acme/db/client", () => ({ db: {} }));

describe("clampMessages", () => {
  it("keeps only the last 12 messages", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
    }));
    const out = clampMessages(msgs);
    expect(out).toHaveLength(12);
    expect(out[0]?.content).toBe("m8");
  });

  it("truncates long messages to 4000 chars", () => {
    const out = clampMessages([{ role: "user", content: "x".repeat(5000) }]);
    expect(out[0]?.content).toHaveLength(4000);
  });
});

describe("evaluateGates", () => {
  const base = {
    widgetsLimit: 5,
    sessionCount: 0,
    ipCount: 0,
    widgetCount: 0,
    spentTodayCents: 0,
    capCents: 500,
  };

  it("passes under all limits", () => {
    expect(evaluateGates(base)).toEqual({ ok: true });
  });

  it("refuses free plan (widgetsLimit 0) with 402", () => {
    expect(evaluateGates({ ...base, widgetsLimit: 0 })).toMatchObject({
      ok: false,
      status: 402,
    });
  });

  it("rate-limits the visitor session at 8/min", () => {
    expect(evaluateGates({ ...base, sessionCount: 8 })).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("rate-limits the ip at 20/min", () => {
    expect(evaluateGates({ ...base, ipCount: 20 })).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("rate-limits the widget at 60/min", () => {
    expect(evaluateGates({ ...base, widgetCount: 60 })).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("stops at the daily spend cap", () => {
    expect(
      evaluateGates({ ...base, spentTodayCents: 500, capCents: 500 }),
    ).toMatchObject({ ok: false, status: 429 });
  });
});
