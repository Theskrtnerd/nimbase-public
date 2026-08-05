import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GardenerError } from "@acme/runtime/memory/wiki";

import { processCompileJob } from "./process";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  getObjectText: vi.fn(),
  updateSet: vi.fn(),
  selectLimit: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("@acme/db", () => ({ and: vi.fn(), eq: vi.fn(), isNull: vi.fn() }));
vi.mock("@acme/db/schema", () => ({
  CompileJob: {},
  Source: {},
  SpendLedger: {},
  WikiNode: { restricted: "restricted" },
}));
// select() is called several times per job:
//  1. source row (.where().limit())
//  2. targetFolder lookup (.where().limit()) — only when targetFolderId set
//  3. restricted rows (.where()) — no .limit(), returns a thenable array
// The where() mock returns an object that is both limitable and directly
// awaitable (thenable) so both call shapes work.
vi.mock("@acme/db/client", () => ({
  db: {
    update: vi.fn(() => ({ set: mocks.updateSet })),
    insert: vi.fn(() => ({ values: mocks.insertValues })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mocks.selectLimit,
          // Make this a thenable so process.ts can await it directly for the
          // restricted-rows query (which has no .limit() call).
          then: (
            resolve: (v: unknown[]) => unknown,
            reject: (e: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        })),
      })),
    })),
  },
}));
vi.mock("@acme/runtime/ai", () => {
  // Mirror the registry pricing so cost assertions stay meaningful; the exact
  // pricing math is covered by packages/runtime/src/ai/cost.test.ts.
  const PRICING: Record<string, { input: number; output: number }> = {
    "anthropic/claude-sonnet-4.6": { input: 300, output: 1500 },
  };
  return {
    resolveModels: () =>
      Promise.resolve({
        chat: {
          id: "anthropic/claude-sonnet-4.6",
          model: "anthropic/claude-sonnet-4.6",
        },
      }),
    costFor: (id: string, u: { inputTokens: number; outputTokens: number }) => {
      const rate = PRICING[id] ?? { input: 0, output: 0 };
      return Math.round(
        (u.inputTokens * rate.input + u.outputTokens * rate.output) / 1_000_000,
      );
    },
  };
});
vi.mock("@acme/runtime/s3", () => ({
  getObjectText: mocks.getObjectText,
}));
vi.mock("@acme/runtime/memory", () => ({
  // The compile worker builds a system provider context; reconcile is mocked
  // (below) and ignores it, so a bare stub is enough.
  toProviderContext: () => ({}),
}));
// Only GardenerError is needed from the wiki internals; stub it (rather than
// loading the real gardener/VFS graph) so `err instanceof GardenerError` in the
// failure path resolves to the same class the test throws.
vi.mock("@acme/runtime/memory/wiki", () => ({
  GardenerError: class GardenerError extends Error {
    partialReport: string;
    constructor(message: string, partialReport: string) {
      super(message);
      this.partialReport = partialReport;
    }
  },
}));
// The memory backend: processCompileJob drives writes through the shared
// memoryProvider singleton's reconcile.
vi.mock("@acme/runtime/memory/wiki-pg-provider", () => ({
  memoryProvider: { reconcile: mocks.reconcile },
}));

beforeEach(() => {
  mocks.updateSet.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.selectLimit.mockResolvedValue([
    {
      id: "src_1",
      kind: "web",
      title: "A page",
      s3KeyOriginal: "original/key.md",
      s3KeyRawMd: "raw/key.md",
      targetFolderId: null,
    },
  ]);
  mocks.getObjectText.mockResolvedValue("captured text");
  mocks.reconcile.mockResolvedValue({
    action: "merge",
    nodeId: "node_1",
    report: "merged into projects/nimbase",
    usage: { inputTokens: 100_000, outputTokens: 10_000 },
  });
});

afterEach(() => vi.clearAllMocks());

const JOB = { workspaceId: "ws_1", sourceId: "src_1", jobId: "job_1" };

describe("processCompileJob", () => {
  it("refuses provider evidence even if a stale compile job exists", async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      {
        id: "src_1",
        kind: "web",
        status: "queued",
        accessPolicyId: "policy-1",
        s3KeyOriginal: "original/key.md",
        s3KeyRawMd: "raw/key.md",
        targetFolderId: null,
      },
    ]);

    await processCompileJob(JOB);

    expect(mocks.getObjectText).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "held",
      error: null,
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "provider access policy blocks compilation",
      }),
    );
  });

  it("reads raw.md and feeds it to the provider's reconcile", async () => {
    await processCompileJob(JOB);
    expect(mocks.getObjectText).toHaveBeenCalledWith("raw/key.md");
    // reconcile(ctx, candidate, options): the candidate carries the raw text +
    // source kind; options carry the provenance + resolved model.
    expect(mocks.reconcile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: "captured text", sourceKind: "web" }),
      expect.objectContaining({ sourceId: "src_1", jobId: "job_1" }),
    );
  });

  it("falls back to the original when raw.md is unset (pre-migration row)", async () => {
    mocks.selectLimit.mockResolvedValue([
      {
        id: "src_1",
        kind: "web",
        title: "A page",
        s3KeyOriginal: "original/key.md",
        s3KeyRawMd: null,
        targetFolderId: null,
      },
    ]);
    await processCompileJob(JOB);
    expect(mocks.getObjectText).toHaveBeenCalledWith("original/key.md");
  });

  it("marks source compiled with the gardener's report", async () => {
    await processCompileJob(JOB);
    const compiled = mocks.updateSet.mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "compiled",
    );
    expect(compiled?.[0]).toMatchObject({
      compileReport: "merged into projects/nimbase",
    });
  });

  it("records token usage and a compile spend entry", async () => {
    await processCompileJob(JOB);
    // $3/MTok in + $15/MTok out → 100k in = 30¢, 10k out = 15¢ → 45¢
    const done = mocks.updateSet.mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "done",
    );
    expect(done?.[0]).toMatchObject({
      tokenUsage: { input: 100_000, output: 10_000, costCents: 45 },
    });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "compile", cents: 45, jobId: "job_1" }),
    );
  });

  it("logs the typed reconcile outcome for the job", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await processCompileJob(JOB);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("reconcile merge"),
      expect.objectContaining({ jobId: "job_1", sourceId: "src_1" }),
    );
    info.mockRestore();
  });

  it("saves the partial report and fails the job on GardenerError", async () => {
    mocks.reconcile.mockRejectedValue(
      new GardenerError("gateway 500", "step one done"),
    );
    await expect(processCompileJob(JOB)).rejects.toThrow("gateway 500");
    const failed = mocks.updateSet.mock.calls.filter(
      (c) => (c[0] as { status?: string }).status === "failed",
    );
    expect(failed).toHaveLength(2); // Source + CompileJob
    expect(
      failed.some(
        (c) =>
          (c[0] as { compileReport?: string }).compileReport ===
          "step one done",
      ),
    ).toBe(true);
  });
});
