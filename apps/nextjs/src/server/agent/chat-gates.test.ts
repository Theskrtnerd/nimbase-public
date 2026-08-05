import { describe, expect, it } from "vitest";

import { evaluateAgentChatGate } from "./chat-gates";

describe("evaluateAgentChatGate", () => {
  const base = {
    requestsLastMinute: 0,
    spentTodayCents: 0,
    requestsPerMinute: 30,
    dailyBudgetCents: 2500,
  };

  it("allows requests below both operational limits", () => {
    expect(evaluateAgentChatGate(base)).toEqual({ ok: true });
  });

  it("blocks a workspace at its per-minute request limit", () => {
    expect(
      evaluateAgentChatGate({ ...base, requestsLastMinute: 30 }),
    ).toMatchObject({ ok: false, status: 429 });
  });

  it("blocks a workspace at its daily spend budget", () => {
    expect(
      evaluateAgentChatGate({ ...base, spentTodayCents: 2500 }),
    ).toMatchObject({ ok: false, status: 429 });
  });

  it("allows operators to disable the spend budget for local models", () => {
    expect(
      evaluateAgentChatGate({
        ...base,
        spentTodayCents: 1_000_000,
        dailyBudgetCents: 0,
      }),
    ).toEqual({ ok: true });
  });
});
