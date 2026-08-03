import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GardenerError, runGardener } from "./gardener";
import { VfsError } from "./vfs";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  traceGeneration: vi.fn((_trace: unknown, generate: () => unknown) =>
    generate(),
  ),
  tree: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  isStepCount: vi.fn(() => "step-cap"),
  tool: (def: unknown) => def,
}));
// runGardener loads the real vfs/vfs-read-tools module graph (only GardenerFs is
// stubbed below), so mock their storage-facing deps to keep this a pure unit
// test: s3 and the db client never connect, and search/telemetry are stubbed.
// The gardener takes its model as an arg now, so no model constant is needed.
vi.mock("../../s3", () => ({}));
vi.mock("@acme/db/client", () => ({ db: {} }));
vi.mock("../../ai/telemetry", () => ({
  traceGeneration: mocks.traceGeneration,
}));
vi.mock("../../search", () => ({ searchWorkspace: vi.fn() }));
vi.mock("./vfs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    // ops() lets runGardener read the recorded mutations back; empty here since
    // the stubbed FS performs none (the tools are never really executed).
    GardenerFs: vi.fn(() => ({ tree: mocks.tree, ops: () => [] })),
  };
});

const ARGS = {
  workspaceId: "ws_1",
  sourceId: "src_1",
  jobId: "job_1",
  sourceKind: "web",
  sourceTitle: "A page",
  rawText: "captured text",
  fence: { prefix: "", exclude: [] },
  chatModel: "anthropic/test-model",
  chatModelId: "anthropic/test-model",
};

beforeEach(() => {
  mocks.generateText.mockResolvedValue({
    text: "merged into projects/nimbase",
    totalUsage: { inputTokens: 1000, outputTokens: 200 },
  });
});

afterEach(() => vi.clearAllMocks());

describe("runGardener", () => {
  it("returns the final text as report with usage", async () => {
    const result = await runGardener(ARGS);
    expect(result.report).toBe("merged into projects/nimbase");
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
  });

  it("surfaces the FS's recorded ops for the reconcile front door", async () => {
    const result = await runGardener(ARGS);
    // The stubbed FS records nothing; the real one records write/edit/rm ops.
    expect(result.ops).toEqual([]);
  });

  it("registers the full tool surface and the source in the prompt", async () => {
    await runGardener(ARGS);
    const call = mocks.generateText.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
      prompt: string;
      model: string;
    };
    expect(Object.keys(call.tools).sort()).toEqual([
      "cite_sources",
      "edit",
      "grep",
      "list_citations",
      "list_tags",
      "mv",
      "read",
      "rm",
      "search",
      "set_tags",
      "set_title",
      "tree",
      "write",
    ]);
    expect(call.prompt).toContain("captured text");
    expect(call.model).toBe("anthropic/test-model");
  });

  it("tells the gardener to extract durable knowledge from conversations", async () => {
    await runGardener({ ...ARGS, sourceKind: "chat_export" });
    const call = mocks.generateText.mock.calls[0]?.[0] as {
      instructions: string;
    };
    expect(call.instructions).toContain(
      "Keep the transcript as source evidence",
    );
    expect(call.instructions).toContain(
      "If the conversation contains no durable company knowledge",
    );
  });

  it("returns VfsError messages as tool results instead of throwing", async () => {
    mocks.tree.mockRejectedValue(new VfsError("nope"));
    await runGardener(ARGS);
    const call = mocks.generateText.mock.calls[0]?.[0] as {
      tools: { tree: { execute: () => Promise<string> } };
    };
    await expect(call.tools.tree.execute()).resolves.toBe("error: nope");
  });

  it("wraps loop failures in GardenerError with the partial report", async () => {
    mocks.generateText.mockImplementation(
      ({ onStepEnd }: { onStepEnd: (s: { text: string }) => void }) => {
        onStepEnd({ text: "step one done" });
        return Promise.reject(new Error("gateway 500"));
      },
    );
    const err = await runGardener(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GardenerError);
    expect((err as GardenerError).partialReport).toContain("step one done");
  });
});
