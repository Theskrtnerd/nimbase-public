import { describe, expect, it, vi } from "vitest";

import { signState, verifyState } from "./oauth-state";

vi.mock("~/env", () => ({
  env: { AGENT_CONNECTION_SECRET: "test-agent-connection-secret" },
}));

describe("agent OAuth state", () => {
  it("round-trips a CLI loopback redirect", () => {
    const payload = {
      agentId: "09bd8306-fc65-44ab-99b3-f819810b0ee8",
      userId: "user_1",
      redirect: "http://127.0.0.1:45678/callback?state=cli-state",
    };
    expect(verifyState(signState(payload))).toEqual(payload);
  });

  it("rejects a tampered state", () => {
    const signed = signState({
      agentId: "09bd8306-fc65-44ab-99b3-f819810b0ee8",
      userId: "user_1",
    });
    expect(verifyState(`${signed}x`)).toBeNull();
  });
});
