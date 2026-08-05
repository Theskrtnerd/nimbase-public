import { beforeEach, describe, expect, it, vi } from "vitest";

import { GardenerError } from "../memory/wiki/gardener";
import { runGardenerHarness } from "./gardener";

const mocks = vi.hoisted(() => ({
  runHarnessAgent: vi.fn(),
  buildHarnessMounts: vi.fn(() => ({ fs: {}, readOutput: vi.fn() })),
  resolveHarnessModel: vi.fn(() =>
    Promise.resolve({ modelId: "anthropic/claude-sonnet-4.6", pi: {} }),
  ),
  kbSearchTool: vi.fn(() => ({ search: {} })),
  gardenerDomainTools: vi.fn(() => ({ set_tags: {} })),
  ops: vi.fn(() => [
    { op: "create", kind: "note", path: "a.md", nodeId: "n1" },
  ]),
  prime: vi.fn(),
}));

vi.mock("./run", () => ({
  buildHarnessMounts: mocks.buildHarnessMounts,
}));
// The cloud-bound forms live in ./bindings; only gardenerDomainTools is taken
// straight from the pure ./tools module.
vi.mock("./bindings", () => ({
  kbSearchTool: mocks.kbSearchTool,
  resolveHarnessModel: mocks.resolveHarnessModel,
  runHarnessAgent: mocks.runHarnessAgent,
}));
vi.mock("./tools", () => ({
  gardenerDomainTools: mocks.gardenerDomainTools,
}));
vi.mock("./wiki-file-system", () => ({
  WikiFileSystem: { readWrite: vi.fn(() => ({ prime: mocks.prime })) },
}));
vi.mock("../memory/wiki/vfs", () => ({
  GardenerFs: class {
    ops = mocks.ops;
  },
}));

const ARGS = {
  workspaceId: "ws-1",
  sourceId: "src-1",
  jobId: "job-1",
  sourceKind: "web",
  sourceTitle: "A Page",
  rawText: "captured text",
  fence: { prefix: "projects", exclude: [] },
};

describe("runGardenerHarness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runHarnessAgent.mockResolvedValue({
      text: "merged into projects/a.md",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it("runs the gardener agent over the mounted wiki and returns report/usage/ops", async () => {
    const result = await runGardenerHarness(ARGS);
    expect(mocks.prime).toHaveBeenCalled();
    expect(result).toEqual({
      report: "merged into projects/a.md",
      usage: { inputTokens: 10, outputTokens: 20 },
      ops: [{ op: "create", kind: "note", path: "a.md", nodeId: "n1" }],
    });

    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      agent: string;
      prompt: string;
      instructionsExtra: string[];
      tools: Record<string, unknown>;
    };
    expect(call.agent).toBe("gardener");
    expect(call.prompt).toContain('<source kind="web" title="A Page">');
    expect(call.prompt).toContain("captured text");
    // Blocks are emitted only when they apply, so assert on content rather
    // than position.
    const blocks = call.instructionsExtra.join("\n\n");
    expect(blocks).not.toContain("<company-context>"); // none in ARGS
    expect(blocks).toContain('"/wiki/projects/"');
    expect(Object.keys(call.tools)).toEqual(["search", "set_tags"]);
  });

  it("omits the fence line at the centralized KB root", async () => {
    await runGardenerHarness({
      ...ARGS,
      fence: { prefix: "", exclude: [] },
    });
    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      instructionsExtra: string[];
    };
    const blocks = call.instructionsExtra.join("\n\n");
    expect(blocks).not.toContain("<company-context>"); // no company context
    expect(blocks).not.toContain("You are working inside"); // no fence at root
  });

  it("injects the company-context block when provided", async () => {
    await runGardenerHarness({
      ...ARGS,
      companyContext: "# Acme\n\nWe build rockets.",
    });
    const call = mocks.runHarnessAgent.mock.calls[0]?.[0] as {
      instructionsExtra: string[];
    };
    const blocks = call.instructionsExtra.join("\n\n");
    expect(blocks).toContain("<company-context>");
    expect(blocks).toContain("We build rockets.");
  });

  it("wraps harness failures in GardenerError", async () => {
    mocks.runHarnessAgent.mockRejectedValue(new Error("session timed out"));
    const err = await runGardenerHarness(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GardenerError);
    expect((err as GardenerError).message).toBe("session timed out");
    expect((err as GardenerError).partialReport).toBe("");
  });
});
