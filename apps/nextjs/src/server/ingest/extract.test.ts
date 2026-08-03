import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processExtractJob } from "./extract";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
  insertValues: vi.fn(),
  returning: vi.fn(),
  getObjectBytes: vi.fn(),
  putObject: vi.fn(),
  rawMdSource: vi.fn((_w: string, s: string) => `raw/${s}.md`),
  buildRawMd: vi.fn(() => "---\nkind: screenshot\n---\n\nextracted"),
  costFor: vi.fn(() => 0),
  extractBinaryText: vi.fn(),
  parseBytes: vi.fn(),
  isParseableMime: vi.fn(() => false),
  parseConfigured: vi.fn(() => false),
  dispatchCompile: vi.fn(),
  expandZipSource: vi.fn(),
}));

vi.mock("@acme/db", () => ({ eq: vi.fn() }));
vi.mock("@acme/db/schema", () => ({
  CompileJob: {},
  Source: {},
  SpendLedger: {},
}));
vi.mock("@acme/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
    update: vi.fn(() => ({ set: mocks.updateSet })),
    insert: vi.fn(() => ({ values: mocks.insertValues })),
  },
}));
vi.mock("@acme/cloud", () => ({
  s3: {
    s3KeyFor: { rawMdSource: mocks.rawMdSource },
    getObjectBytes: mocks.getObjectBytes,
    putObject: mocks.putObject,
  },
  buildRawMd: mocks.buildRawMd,
  costFor: mocks.costFor,
  extractBinaryText: mocks.extractBinaryText,
  parseBytes: mocks.parseBytes,
  isParseableMime: mocks.isParseableMime,
  parseConfigured: mocks.parseConfigured,
}));
vi.mock("~/server/compile/dispatch", () => ({
  dispatchCompile: mocks.dispatchCompile,
}));
// Only the side-effecting half is mocked. buildArchiveManifest and
// isZipSource live in ./zip-entries (pure, no db/S3), so the real ones run and
// the manifest assertions below exercise them.
vi.mock("./expand-zip", () => ({ expandZipSource: mocks.expandZipSource }));

const BASE_SOURCE = {
  id: "src_1",
  workspaceId: "ws_1",
  kind: "screenshot",
  title: "A screenshot",
  status: "extracting",
  mimeType: "image/png",
  originalFilename: null,
  sizeBytes: 100,
  capturedAt: null,
  metadata: null,
  s3KeyOriginal: "original/src_1.png",
};

beforeEach(() => {
  mocks.updateSet.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  mocks.returning.mockResolvedValue([{ id: "job_1" }]);
  mocks.insertValues.mockImplementation(() =>
    Object.assign(Promise.resolve(undefined), { returning: mocks.returning }),
  );
  mocks.getObjectBytes.mockResolvedValue(new TextEncoder().encode("bytes"));
  mocks.putObject.mockResolvedValue(undefined);
  mocks.extractBinaryText.mockResolvedValue({
    markdown: "OCR text",
    modelId: "google/gemini-2.5-flash",
    usage: { inputTokens: 1000, outputTokens: 100 },
  });
  mocks.costFor.mockReturnValue(5);
  // Reset explicitly: clearAllMocks drops recorded calls but keeps
  // implementations, so a mockReturnValue(true) in the Context.dev describe
  // would otherwise leak into every later test and reroute the AI path.
  mocks.parseConfigured.mockReturnValue(false);
  mocks.isParseableMime.mockReturnValue(false);
  mocks.dispatchCompile.mockResolvedValue(undefined);
  mocks.expandZipSource.mockResolvedValue({
    childCount: 3,
    childJobs: [1, 2, 3].map((n) => ({
      jobId: `job_${n}`,
      workspaceId: "ws_1",
      sourceId: `child_${n}`,
    })),
    skipped: [],
    limitReached: null,
  });
  mocks.selectLimit.mockResolvedValue([{ ...BASE_SOURCE }]);
});

const ZIP_SOURCE = {
  ...BASE_SOURCE,
  kind: "file",
  mimeType: "application/zip",
  originalFilename: "wiki-export.zip",
};

afterEach(() => vi.clearAllMocks());

const JOB = { jobId: "extract_1", workspaceId: "ws_1", sourceId: "src_1" };

describe("processExtractJob", () => {
  it("extracts a screenshot via AI, records spend, and dispatches compile", async () => {
    // Only an archive yields child jobs; every other path returns none.
    expect(await processExtractJob(JOB)).toEqual([]);

    expect(mocks.extractBinaryText).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "screenshot", mimeType: "image/png" }),
    );
    expect(mocks.buildRawMd).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "screenshot",
        body: "OCR text",
        metadata: { extractionModelId: "google/gemini-2.5-flash" },
      }),
    );
    expect(mocks.putObject).toHaveBeenCalledWith(
      "raw/src_1.md",
      "---\nkind: screenshot\n---\n\nextracted",
      "text/markdown",
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ s3KeyRawMd: "raw/src_1.md", status: "queued" }),
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "extract", cents: 5, jobId: null }),
    );
    expect(mocks.dispatchCompile).toHaveBeenCalledWith({
      jobId: "job_1",
      workspaceId: "ws_1",
      sourceId: "src_1",
    });
  });

  it("normalizes provider binaries but holds them outside compilation", async () => {
    mocks.selectLimit.mockResolvedValue([
      { ...BASE_SOURCE, accessPolicyId: "policy-1" },
    ]);

    await processExtractJob(JOB);

    expect(mocks.putObject).toHaveBeenCalled();
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "held" }),
    );
    expect(mocks.dispatchCompile).not.toHaveBeenCalled();
  });

  it("skips the spend entry when the extraction call is free", async () => {
    mocks.costFor.mockReturnValue(0);
    await processExtractJob(JOB);
    expect(mocks.insertValues).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "extract" }),
    );
  });

  it("decodes a text-native file directly with no AI call", async () => {
    mocks.selectLimit.mockResolvedValue([
      {
        ...BASE_SOURCE,
        kind: "file",
        mimeType: "text/plain",
        originalFilename: "notes.txt",
      },
    ]);
    mocks.getObjectBytes.mockResolvedValue(
      new TextEncoder().encode("hello from disk"),
    );

    await processExtractJob(JOB);

    expect(mocks.extractBinaryText).not.toHaveBeenCalled();
    expect(mocks.buildRawMd).toHaveBeenCalledWith(
      expect.objectContaining({ body: "hello from disk" }),
    );
    expect(mocks.insertValues).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "extract" }),
    );
    expect(mocks.dispatchCompile).toHaveBeenCalled();
  });

  it("is idempotent — a retry after raw.md landed is a no-op", async () => {
    mocks.selectLimit.mockResolvedValue([
      { ...BASE_SOURCE, status: "queued", s3KeyRawMd: "raw/src_1.md" },
    ]);
    await processExtractJob(JOB);
    expect(mocks.getObjectBytes).not.toHaveBeenCalled();
    expect(mocks.extractBinaryText).not.toHaveBeenCalled();
    expect(mocks.dispatchCompile).not.toHaveBeenCalled();
  });

  it("keeps a metadata-only capture for a file mime with no extraction path", async () => {
    mocks.selectLimit.mockResolvedValue([
      { ...BASE_SOURCE, kind: "file", mimeType: "application/x-sqlite3" },
    ]);

    await processExtractJob(JOB);

    expect(mocks.extractBinaryText).not.toHaveBeenCalled();
    expect(mocks.parseBytes).not.toHaveBeenCalled();
    expect(mocks.buildRawMd).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "No text extraction available",
        ) as unknown,
      }),
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued" }),
    );
    expect(mocks.dispatchCompile).toHaveBeenCalled();
  });

  describe("Context.dev document extraction", () => {
    const PDF_SOURCE = {
      ...BASE_SOURCE,
      kind: "file",
      mimeType: "application/pdf",
      originalFilename: "q3-report.pdf",
    };

    beforeEach(() => {
      mocks.parseConfigured.mockReturnValue(true);
      mocks.isParseableMime.mockReturnValue(true);
      mocks.parseBytes.mockResolvedValue({
        markdown: "# Q3 report\n\nRevenue grew.",
        type: "pdf",
        creditsConsumed: 1,
        creditsRemaining: 4999,
      });
    });

    it("parses a document into raw.md and records the extractor", async () => {
      mocks.selectLimit.mockResolvedValue([PDF_SOURCE]);

      await processExtractJob(JOB);

      expect(mocks.parseBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType: "application/pdf",
          extension: "pdf",
        }),
      );
      // The document path is not an AI call, so it must not bill the workspace
      // the way extractBinaryText does.
      expect(mocks.extractBinaryText).not.toHaveBeenCalled();
      expect(mocks.buildRawMd).toHaveBeenCalledWith(
        expect.objectContaining({ body: "# Q3 report\n\nRevenue grew." }),
      );
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "queued",
          metadata: expect.objectContaining({
            extractedBy: "context.dev:pdf",
          }) as unknown,
        }),
      );
      expect(mocks.dispatchCompile).toHaveBeenCalled();
    });

    it("routes screenshots to parse instead of the AI extractor", async () => {
      mocks.selectLimit.mockResolvedValue([{ ...BASE_SOURCE }]);

      await processExtractJob(JOB);

      expect(mocks.parseBytes).toHaveBeenCalled();
      expect(mocks.extractBinaryText).not.toHaveBeenCalled();
    });

    it("keeps voice on the AI extractor — Context.dev has no audio path", async () => {
      mocks.selectLimit.mockResolvedValue([
        { ...BASE_SOURCE, kind: "voice", mimeType: "audio/webm" },
      ]);

      await processExtractJob(JOB);

      expect(mocks.parseBytes).not.toHaveBeenCalled();
      expect(mocks.extractBinaryText).toHaveBeenCalled();
    });

    it("degrades to the stub when parse fails, without failing the source", async () => {
      mocks.selectLimit.mockResolvedValue([PDF_SOURCE]);
      mocks.parseBytes.mockRejectedValue(new Error("context.dev 503"));

      await expect(processExtractJob(JOB)).resolves.toEqual([]);

      expect(mocks.buildRawMd).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            "No text extraction available",
          ) as unknown,
        }),
      );
      expect(mocks.updateSet).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
      expect(mocks.dispatchCompile).toHaveBeenCalled();
    });

    it("degrades to the stub when parse returns empty markdown", async () => {
      mocks.selectLimit.mockResolvedValue([PDF_SOURCE]);
      mocks.parseBytes.mockResolvedValue({
        markdown: "   \n ",
        type: "pdf",
        creditsConsumed: 1,
        creditsRemaining: 4999,
      });

      await processExtractJob(JOB);

      expect(mocks.buildRawMd).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            "No text extraction available",
          ) as unknown,
        }),
      );
    });

    it("falls back to the AI extractor for images when the key is unset", async () => {
      mocks.parseConfigured.mockReturnValue(false);
      mocks.selectLimit.mockResolvedValue([{ ...BASE_SOURCE }]);

      await processExtractJob(JOB);

      expect(mocks.parseBytes).not.toHaveBeenCalled();
      expect(mocks.extractBinaryText).toHaveBeenCalled();
    });

    it("still decodes text-native files locally rather than spending a credit", async () => {
      mocks.selectLimit.mockResolvedValue([
        { ...BASE_SOURCE, kind: "file", mimeType: "text/markdown" },
      ]);

      await processExtractJob(JOB);

      expect(mocks.parseBytes).not.toHaveBeenCalled();
      expect(mocks.buildRawMd).toHaveBeenCalledWith(
        expect.objectContaining({ body: "bytes" }),
      );
    });
  });

  it("marks the source failed and rethrows when the AI call itself fails", async () => {
    mocks.extractBinaryText.mockRejectedValue(new Error("gateway 500"));
    await expect(processExtractJob(JOB)).rejects.toThrow("gateway 500");
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "gateway 500" }),
    );
  });

  it("throws when the source no longer exists", async () => {
    mocks.selectLimit.mockResolvedValue([]);
    await expect(processExtractJob(JOB)).rejects.toThrow("not found");
  });

  describe("archive expansion", () => {
    it("expands a zip and never compiles the container itself", async () => {
      mocks.selectLimit.mockResolvedValue([{ ...ZIP_SOURCE }]);

      const childJobs = await processExtractJob(JOB);

      // The children are handed back for the caller to dispatch, never
      // dispatched here — that inversion is what keeps expand-zip off the
      // dispatcher that imports this module.
      expect(childJobs.map((j) => j.sourceId)).toEqual([
        "child_1",
        "child_2",
        "child_3",
      ]);
      expect(mocks.expandZipSource).toHaveBeenCalledWith(
        expect.objectContaining({ id: "src_1" }),
        expect.any(Uint8Array),
      );
      expect(mocks.extractBinaryText).not.toHaveBeenCalled();
      // The container is transport, not content — compiling it would write a
      // "contents of wiki-export.zip" note into memory.
      expect(mocks.dispatchCompile).not.toHaveBeenCalled();
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "compiled",
          compileReport: "Expanded into 3 sources.",
        }),
      );
    });

    it("detects a zip by filename when the browser sends a generic mime", async () => {
      mocks.selectLimit.mockResolvedValue([
        {
          ...ZIP_SOURCE,
          mimeType: "application/octet-stream",
        },
      ]);
      await processExtractJob(JOB);
      expect(mocks.expandZipSource).toHaveBeenCalled();
    });

    it("records skipped entries and an early stop in the manifest", async () => {
      mocks.selectLimit.mockResolvedValue([{ ...ZIP_SOURCE }]);
      mocks.expandZipSource.mockResolvedValue({
        childCount: 1,
        childJobs: [
          { jobId: "job_1", workspaceId: "ws_1", sourceId: "child_1" },
        ],
        skipped: ["big.psd — file larger than 5242880 bytes"],
        limitReached: "capture limit reached",
      });

      await processExtractJob(JOB);

      const report = mocks.updateSet.mock.calls[0]?.[0] as {
        compileReport: string;
      };
      expect(report.compileReport).toContain("Expanded into 1 source.");
      expect(report.compileReport).toContain(
        "Stopped early: capture limit reached",
      );
      expect(report.compileReport).toContain("- big.psd — file larger than");
    });

    it("marks the container failed when expansion throws", async () => {
      mocks.selectLimit.mockResolvedValue([{ ...ZIP_SOURCE }]);
      mocks.expandZipSource.mockRejectedValue(new Error("corrupt archive"));

      await expect(processExtractJob(JOB)).rejects.toThrow("corrupt archive");
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", error: "corrupt archive" }),
      );
    });

    it("is idempotent — a retry after expansion does not re-expand", async () => {
      mocks.selectLimit.mockResolvedValue([
        { ...ZIP_SOURCE, status: "compiled" },
      ]);
      await processExtractJob(JOB);
      expect(mocks.expandZipSource).not.toHaveBeenCalled();
    });
  });
});
