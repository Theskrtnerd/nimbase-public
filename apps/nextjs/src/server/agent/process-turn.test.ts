import { beforeEach, describe, expect, it, vi } from "vitest";

import { processAgentTurn } from "./process-turn";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[],
  insertValues: vi.fn(),
  runHarnessAgent: vi.fn(),
  prime: vi.fn(),
  fetchMessages: vi.fn(),
  toAiMessages: vi.fn(),
  post: vi.fn(),
  startTyping: vi.fn(),
  withBotToken: vi.fn(),
  resolveAgentScopes: vi.fn(),
  agentArtifactTools: vi.fn(() => ({ create_artifact: { execute: vi.fn() } })),
}));

// db.select().from().where().limit() — a thenable chain that resolves to the
// next queued result regardless of which chain methods the call site uses.
function chainResult() {
  const result = mocks.selectResults.shift() ?? [];
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock("@acme/db", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));
vi.mock("@acme/db/schema", () => ({
  Agent: {},
  AgentConnection: {},
  AgentTurn: { connectionId: {}, createdAt: {}, agentId: {}, costCents: {} },
  SpendLedger: {},
}));
vi.mock("@acme/db/client", () => ({
  db: {
    select: () => chainResult(),
    insert: () => ({ values: mocks.insertValues }),
  },
}));
vi.mock("@acme/api/access", () => ({
  resolveAgentScopes: mocks.resolveAgentScopes,
}));
vi.mock("@acme/cloud", () => ({
  costFor: (_id: string, u: { inputTokens: number; outputTokens: number }) =>
    Math.round((u.inputTokens * 300 + u.outputTokens * 1500) / 1_000_000),
}));
vi.mock("@acme/cloud/harness", () => ({
  runHarnessAgent: mocks.runHarnessAgent,
  buildHarnessMounts: () => ({ fs: {}, readOutput: vi.fn() }),
  kbSearchTool: () => ({ search: {} }),
  resolveHarnessModel: () =>
    Promise.resolve({ modelId: "anthropic/claude-sonnet-4.6", pi: {} }),
  WikiFileSystem: { readOnly: () => ({ prime: mocks.prime }) },
}));
vi.mock("@acme/cloud/memory/wiki", () => ({ WikiReadFs: class {} }));
vi.mock("chat/ai", () => ({ toAiMessages: mocks.toAiMessages }));
vi.mock("./bot", () => ({
  getBotRuntime: () => ({
    bot: {
      thread: () => ({
        id: "slack:chan:1699.1",
        adapter: { fetchMessages: mocks.fetchMessages },
        post: mocks.post,
        startTyping: mocks.startTyping,
      }),
    },
    // The credential binder just runs the callback — the point under test is
    // that the turn happens *inside* it, not how it binds.
    slackAdapter: {
      withBotToken: (t: string, fn: () => unknown) => {
        mocks.withBotToken(t);
        return fn();
      },
    },
  }),
}));
// Mocked at the importer's specifier: the real module imports through the `~`
// alias, which vitest does not resolve.
vi.mock("./artifact-tool", () => ({
  agentArtifactTools: mocks.agentArtifactTools,
  BARE_LINK_RULE: "post-bare-link",
}));
vi.mock("./secrets", () => ({
  parseSlackSecrets: () => ({ botToken: "xoxb-1" }),
}));
vi.mock("../connection-secret", () => ({
  decryptConnectionSecret: () => JSON.stringify({ botToken: "xoxb-1" }),
}));

const JOB = {
  jobId: "turn-job-1",
  connectionId: "conn-1",
  threadId: "slack:chan:1699.1",
  externalUserId: "ext-user-1",
  userText: "what is our onboarding doc?",
};

const SCOPES = [{ prefix: "", exclude: [] }];

function queueHappyPathSelects(
  platform = "slack",
  agentOverrides: Record<string, unknown> = {},
) {
  mocks.selectResults.push(
    [
      {
        id: "conn-1",
        agentId: "agent-1",
        platform,
        routeKey: "T123",
        status: "active",
        secretsEncrypted: "enc",
      },
    ],
    [
      {
        id: "agent-1",
        workspaceId: "ws-1",
        enabled: true,
        instructions: "Be helpful.",
        dailyCostCapCents: 500,
        targetFolderId: "folder-1",
        artifactEnabled: false,
        artifactVisibility: "private",
        ...agentOverrides,
      },
    ],
    [{ n: 0 }], // rate window
    [{ cents: 0 }], // daily spend
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectResults.length = 0;
  mocks.resolveAgentScopes.mockResolvedValue(SCOPES);
  mocks.fetchMessages.mockResolvedValue({ messages: [] });
  mocks.toAiMessages.mockResolvedValue([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "what is our onboarding doc?" },
  ]);
  mocks.post.mockResolvedValue(undefined);
  mocks.startTyping.mockResolvedValue(undefined);
  mocks.insertValues.mockResolvedValue([]);
});

describe("processAgentTurn (Pi harness path)", () => {
  beforeEach(() => {
    queueHappyPathSelects();
    mocks.runHarnessAgent.mockResolvedValue({
      text: "See team/onboarding.md",
      usage: { inputTokens: 1000, outputTokens: 2000 },
    });
  });

  it("answers through the harness with the flattened transcript and persona", async () => {
    await processAgentTurn(JOB);

    expect(mocks.prime).toHaveBeenCalled();

    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      agent: string;
      prompt: string;
      instructionsExtra: (string | null)[];
    };
    expect(call.agent).toBe("chat");
    expect(call.prompt).toContain("User: hi");
    expect(call.prompt).toContain("Assistant: hello");
    expect(call.prompt).toContain("Reply to the last user message.");
    expect(call.instructionsExtra).toEqual(["Be helpful."]);

    // Pi returns a finished string, so this path posts once rather than streams.
    expect(mocks.post).toHaveBeenCalledWith("See team/onboarding.md");
    // Turn log records tokens (1000+2000) and cost (3 cents).
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: "See team/onboarding.md",
        tokens: 3000,
        costCents: 3,
        error: null,
      }),
    );
  });

  it("binds the turn to the connection's Slack token", async () => {
    await processAgentTurn(JOB);
    expect(mocks.withBotToken).toHaveBeenCalledWith("xoxb-1");
  });

  it("shows a thinking indicator before answering", async () => {
    await processAgentTurn(JOB);
    expect(mocks.startTyping).toHaveBeenCalledWith("Thinking…");
  });

  it("harness failure posts the apology and logs the error", async () => {
    mocks.runHarnessAgent.mockRejectedValue(new Error("session timed out"));

    await processAgentTurn(JOB);

    expect(mocks.post).toHaveBeenCalledWith(
      "Sorry — I hit an error answering that.",
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ answer: null, error: "session timed out" }),
    );
  });

  it("still answers when the thread history can't be loaded", async () => {
    mocks.fetchMessages.mockRejectedValue(new Error("channel_not_found"));

    await processAgentTurn(JOB);

    // Falls back to the single inbound message rather than failing the turn.
    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain("what is our onboarding doc?");
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ error: null }),
    );
  });
});

describe("processAgentTurn (caps)", () => {
  it("drops the turn when the connection is over its rate window", async () => {
    mocks.selectResults.push(
      [
        {
          id: "conn-1",
          agentId: "agent-1",
          platform: "slack",
          routeKey: "T123",
          status: "active",
          secretsEncrypted: "enc",
        },
      ],
      [{ id: "agent-1", workspaceId: "ws-1", enabled: true, instructions: "" }],
      [{ n: 20 }], // at the limit
    );

    await processAgentTurn(JOB);

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("drops the turn when the agent is over its daily spend cap", async () => {
    mocks.selectResults.push(
      [
        {
          id: "conn-1",
          agentId: "agent-1",
          platform: "slack",
          routeKey: "T123",
          status: "active",
          secretsEncrypted: "enc",
        },
      ],
      [
        {
          id: "agent-1",
          workspaceId: "ws-1",
          enabled: true,
          instructions: "",
          dailyCostCapCents: 500,
        },
      ],
      [{ n: 0 }],
      [{ cents: 500 }], // at the cap
    );

    await processAgentTurn(JOB);

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});

// Artifact authoring is the agent's only write capability and can publish a link
// readable without a Nimbase session, so these tests guard its per-agent gate.
describe("processAgentTurn (artifact tool gating)", () => {
  const artifactAgent = {
    artifactEnabled: true,
    artifactVisibility: "public",
  };

  beforeEach(() => {
    mocks.runHarnessAgent.mockResolvedValue({
      text: "answer",
      usage: { inputTokens: 1, outputTokens: 2 },
    });
  });

  it("withholds the artifact tool when the agent has it disabled", async () => {
    queueHappyPathSelects();

    await processAgentTurn(JOB);

    expect(mocks.agentArtifactTools).not.toHaveBeenCalled();
    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
    };
    expect(Object.keys(call.tools)).not.toContain("create_artifact");
  });

  it("adds the artifact tool when enabled without dropping KB search", async () => {
    queueHappyPathSelects("slack", artifactAgent);

    await processAgentTurn(JOB);

    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
    };
    expect(Object.keys(call.tools)).toContain("create_artifact");
    // The KB read tools survive the merge.
    expect(Object.keys(call.tools)).toContain("search");
  });

  it("extends the harness timeout when the artifact tool is enabled", async () => {
    queueHappyPathSelects("slack", artifactAgent);

    await processAgentTurn(JOB);

    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
      timeoutMs: number;
    };
    expect(Object.keys(call.tools)).toContain("create_artifact");
    // A blocking generation needs more headroom than a plain Q&A turn.
    expect(call.timeoutMs).toBeGreaterThan(120_000);
  });

  it("fences the artifact generator to the agent's own scopes and anchor", async () => {
    queueHappyPathSelects("slack", artifactAgent);

    await processAgentTurn(JOB);

    const calls = mocks.agentArtifactTools.mock.calls as unknown as [
      {
        workspaceId: string;
        targetFolderId: string | null;
        readScopes: unknown;
        visibility: string;
        attachments?: { add: unknown; take: unknown };
      },
    ][];
    const call = calls[0]?.[0];
    expect(call).toMatchObject({
      workspaceId: "ws-1",
      targetFolderId: "folder-1",
      readScopes: SCOPES,
      visibility: "public",
    });
    // Slack can upload, so the tool gets somewhere to leave a rendered file.
    expect(typeof call?.attachments?.add).toBe("function");
    expect(typeof call?.attachments?.take).toBe("function");
  });

  // Slack is the only platform today, but the sink is opt-in per platform
  // rather than assumed: one that can't take bytes must get `undefined`, since
  // withholding it is what makes `link` the only reachable output there. Guards
  // the branch for whichever platform lands next.
  it("gives the artifact tool no attachment sink on a platform without uploads", async () => {
    queueHappyPathSelects("teams", artifactAgent);

    await processAgentTurn(JOB);

    expect(mocks.agentArtifactTools).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: undefined }),
    );
  });
});
