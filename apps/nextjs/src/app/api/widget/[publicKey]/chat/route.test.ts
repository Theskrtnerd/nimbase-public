import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  loadWidgetInterfaceContext: vi.fn(),
  resolveAgentScopes: vi.fn(() =>
    Promise.resolve([{ prefix: "teams/customers", exclude: [] }]),
  ),
  loadGateCounts: vi.fn(),
  resolveEntitlements: vi.fn(),
  assembleKbTurn: vi.fn(() =>
    Promise.resolve({
      model: {},
      modelId: "test-model",
      instructions: "sys",
      tools: {},
      maxOutputTokens: 1500,
    }),
  ),
  streamText: vi.fn(() => ({
    toTextStreamResponse: () => new Response("answer"),
  })),
  agentTurn: { id: "agent-turn-id" },
  insertValues: vi.fn(),
  insertReturning: vi.fn(() => Promise.resolve([{ id: "turn-1" }])),
}));

vi.mock("~/server/agent/interfaces/widget/access", () => ({
  loadWidgetInterfaceContext: mocks.loadWidgetInterfaceContext,
}));
// Real pure gate logic (clampMessages/evaluateGates/hashIp), mocked DB counts.
// importActual must use a relative path — the vitest config has no ~ alias.
vi.mock("~/server/agent/interfaces/widget/gates", async () => {
  const real = await vi.importActual(
    "../../../../../server/agent/interfaces/widget/gates",
  );
  return { ...real, loadGateCounts: mocks.loadGateCounts };
});
vi.mock("@acme/api/access", () => ({
  resolveAgentScopes: mocks.resolveAgentScopes,
}));
vi.mock("@acme/api/entitlements", () => ({
  resolveEntitlements: mocks.resolveEntitlements,
}));
vi.mock("~/server/agent/turn", () => ({
  AGENT_MAX_STEPS: 8,
  AGENT_MAX_TOTAL_TOKENS: 60_000,
  assembleKbTurn: mocks.assembleKbTurn,
}));
vi.mock("ai", () => ({
  streamText: mocks.streamText,
  isStepCount: () => () => false,
}));
vi.mock("@acme/runtime/ai", () => ({ costFor: () => 1 }));
vi.mock("@acme/db/client", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        mocks.insertValues(value);
        return table === mocks.agentTurn
          ? { returning: mocks.insertReturning }
          : Promise.resolve();
      },
    }),
  },
}));
vi.mock("@acme/db/schema", () => ({
  AgentTurn: mocks.agentTurn,
  SpendLedger: {},
}));

const AGENT = {
  id: "a1",
  workspaceId: "ws1",
  targetFolderId: "folder-1",
  enabled: true,
  instructions: "Be helpful.",
  dailyCostCapCents: 500,
};
const CONNECTION = {
  id: "c1",
  agentId: "a1",
  status: "active",
};

function request(body: unknown) {
  return new Request("http://test/api/widget/nb_wgt_x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "x-forwarded-for": "1.2.3.4" },
  });
}
const params = { params: Promise.resolve({ publicKey: "nb_wgt_x" }) };
const goodBody = {
  sessionId: "s1-very-long-session",
  messages: [{ role: "user", content: "hi" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadWidgetInterfaceContext.mockResolvedValue({
    agent: AGENT,
    connection: CONNECTION,
    config: { greeting: "", allowedDomains: [], theme: {} },
    folderPath: "teams/customers",
  });
  mocks.resolveEntitlements.mockResolvedValue({ limits: { widgets: 5 } });
  mocks.loadGateCounts.mockResolvedValue({
    sessionCount: 0,
    ipCount: 0,
    widgetCount: 0,
    spentTodayCents: 0,
  });
});

describe("widget chat route", () => {
  it("404s on unknown key", async () => {
    mocks.loadWidgetInterfaceContext.mockResolvedValue(null);
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(404);
  });

  it("409s when paused", async () => {
    mocks.loadWidgetInterfaceContext.mockResolvedValue({
      agent: AGENT,
      connection: { ...CONNECTION, status: "paused" },
      config: { greeting: "", allowedDomains: [], theme: {} },
      folderPath: "teams/customers",
    });
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(409);
  });

  it("409s when a configured folder has been deleted", async () => {
    mocks.loadWidgetInterfaceContext.mockResolvedValue({
      agent: AGENT,
      connection: CONNECTION,
      config: { greeting: "", allowedDomains: [], theme: {} },
      folderPath: null,
    });
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(409);
  });

  it("402s on free plan", async () => {
    mocks.resolveEntitlements.mockResolvedValue({ limits: { widgets: 0 } });
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(402);
  });

  it("fails open when the entitlements read throws", async () => {
    mocks.resolveEntitlements.mockRejectedValue(new Error("db down"));
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(200);
  });

  it("429s when the session is rate limited", async () => {
    mocks.loadGateCounts.mockResolvedValue({
      sessionCount: 8,
      ipCount: 0,
      widgetCount: 0,
      spentTodayCents: 0,
    });
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(429);
  });

  it("429s past the daily spend cap", async () => {
    mocks.loadGateCounts.mockResolvedValue({
      sessionCount: 0,
      ipCount: 0,
      widgetCount: 0,
      spentTodayCents: 500,
    });
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(429);
  });

  it("400s on a malformed body", async () => {
    const res = await POST(request({ nope: true }), params);
    expect(res.status).toBe(400);
  });

  it("413s before parsing an oversized body", async () => {
    const res = await POST(
      request({
        sessionId: "s1-very-long-session",
        messages: [{ role: "user", content: "x".repeat(70_000) }],
      }),
      params,
    );
    expect(res.status).toBe(413);
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("streams on the happy path with the widget's instructions", async () => {
    const res = await POST(request(goodBody), params);
    expect(res.status).toBe(200);
    const calls = mocks.assembleKbTurn.mock.calls as unknown[][];
    const turnInput = calls[0]?.[0] as {
      workspaceId: string;
      instructions: string;
    };
    expect(turnInput.workspaceId).toBe("ws1");
    expect(turnInput.instructions).toContain("Be helpful.");
    expect(mocks.streamText).toHaveBeenCalled();
    expect(mocks.insertReturning).toHaveBeenCalled();
  });
});
