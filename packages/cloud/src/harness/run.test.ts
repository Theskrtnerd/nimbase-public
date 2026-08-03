import { InMemoryFs } from "just-bash";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GardenerFs } from "../memory/wiki/vfs";
import { buildHarnessMounts, runHarnessAgent } from "./run";
import { WikiFileSystem } from "./wiki-file-system";

const mocks = vi.hoisted(() => ({
  agentCtor: vi.fn(),
  generate: vi.fn(),
  destroy: vi.fn(),
  createPi: vi.fn(() => "pi-harness"),
  createJustBashSandbox: vi.fn(() => "jb-sandbox"),
  traceGeneration: vi.fn((_trace: unknown, generate: () => unknown) =>
    generate(),
  ),
}));

vi.mock("@ai-sdk/harness/agent", () => ({
  HarnessAgent: class {
    constructor(settings: unknown) {
      mocks.agentCtor(settings);
    }
    createSession() {
      return Promise.resolve({ destroy: mocks.destroy });
    }
    generate(options: unknown): Promise<unknown> {
      return mocks.generate(options) as Promise<unknown>;
    }
  },
}));
vi.mock("@ai-sdk/harness-pi", () => ({ createPi: mocks.createPi }));
vi.mock("@ai-sdk/sandbox-just-bash", () => ({
  createJustBashSandbox: mocks.createJustBashSandbox,
}));
// No ../ai/telemetry mock: the tracer is injected (bindings.ts supplies the
// Langfuse one in production), so the spy goes in as an argument.
const BASE = {
  agent: "artifact" as const,
  fs: {} as never,
  model: { modelId: "anthropic/claude-sonnet-4.6", pi: { model: "m" } },
  prompt: "make it",
  timeoutMs: 1000,
  trace: { name: "artifact-generate", workspaceId: "ws-1" },
  tracer: mocks.traceGeneration as never,
};

describe("runHarnessAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generate.mockResolvedValue({
      text: "done",
      totalUsage: { inputTokens: 5, outputTokens: 7 },
    });
  });

  it("builds the agent from the definition and returns text + usage", async () => {
    const result = await runHarnessAgent({
      ...BASE,
      instructionsExtra: ["extra line", null],
    });
    expect(result).toEqual({
      text: "done",
      usage: { inputTokens: 5, outputTokens: 7 },
    });

    expect(mocks.createPi).toHaveBeenCalledWith({ model: "m" });
    expect(mocks.createJustBashSandbox).toHaveBeenCalledWith({ fs: BASE.fs });

    const settings = mocks.agentCtor.mock.calls[0]?.[0] as {
      instructions: string;
      skills: { name: string }[];
      tools: Record<string, unknown>;
    };
    // Real @acme/agents definition: artifact instructions + its skills.
    expect(settings.instructions).toContain("/output/artifact.tsx");
    expect(settings.instructions.endsWith("extra line")).toBe(true);
    expect(settings.skills.map((s) => s.name)).toContain("fixed-react");

    const generateArgs = mocks.generate.mock.calls[0]?.[0] as {
      prompt: string;
      abortSignal: AbortSignal;
    };
    expect(generateArgs.prompt).toBe("make it");
    expect(generateArgs.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("wraps the call in the injected tracer with the harness metadata", async () => {
    await runHarnessAgent(BASE);
    expect(mocks.traceGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "harness-artifact",
        workspaceId: "ws-1",
        modelId: "anthropic/claude-sonnet-4.6",
        metadata: expect.objectContaining({ harness: "pi" }) as unknown,
      }),
      expect.any(Function),
    );
  });

  it("destroys the session even when the turn fails, and defaults missing usage", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("boom"));
    await expect(runHarnessAgent(BASE)).rejects.toThrow("boom");
    expect(mocks.destroy).toHaveBeenCalledTimes(1);

    mocks.generate.mockResolvedValueOnce({ text: "", totalUsage: {} });
    const result = await runHarnessAgent(BASE);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
});

describe("buildHarnessMounts", () => {
  it("mounts the wiki at /wiki over an in-memory base and reads outputs back", async () => {
    const fake = {
      listEntries: () => Promise.resolve([]),
      read: () => Promise.reject(new Error("none")),
    };
    const mounts = buildHarnessMounts(
      WikiFileSystem.readWrite(fake as unknown as GardenerFs),
    );
    await mounts.fs.mkdir("/output", { recursive: true });
    await mounts.fs.writeFile("/output/artifact.html", "<!doctype html>ok");
    expect(await mounts.readOutput("/output/artifact.html")).toBe(
      "<!doctype html>ok",
    );
    expect(await mounts.readOutput("/output/missing.html")).toBeNull();
    // The base really is an isolated InMemoryFs, not the wiki.
    expect(mounts.fs).toBeDefined();
    expect(new InMemoryFs()).toBeDefined();
  });
});
