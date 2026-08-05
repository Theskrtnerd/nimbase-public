import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BinaryIngestError,
  finalizeBinarySource,
  ingestBinaryBytes,
  presignBinarySource,
} from "./ingest-binary";

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  returning: vi.fn(),
  onConflictDoNothing: vi.fn(),
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
  deleteWhere: vi.fn(),
  originalSource: vi.fn(
    (_w: string, _s: string, ext: string) => `original/key.${ext}`,
  ),
  presignPutUrl: vi.fn(),
  headObject: vi.fn(),
  putObject: vi.fn(),
  dispatchExtract: vi.fn(),
  resolveCapturedByName: vi.fn(),
}));

vi.mock("@acme/db", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("@acme/api/entitlements", () => ({
  assertWithinLimit: vi.fn(() => Promise.resolve()),
}));
vi.mock("@acme/db/schema", () => ({ CompileJob: {}, Source: {} }));
vi.mock("@acme/db/client", () => ({
  db: {
    insert: vi.fn(() => ({ values: mocks.insertValues })),
    update: vi.fn(() => ({ set: mocks.updateSet })),
    delete: vi.fn(() => ({ where: mocks.deleteWhere })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
  },
}));
vi.mock("@acme/runtime/s3", () => ({
  s3KeyFor: { originalSource: mocks.originalSource },
  presignPutUrl: mocks.presignPutUrl,
  headObject: mocks.headObject,
  putObject: mocks.putObject,
}));
vi.mock("./extract-dispatch", () => ({
  dispatchExtract: mocks.dispatchExtract,
}));
// Mocked directly (rather than mocking its @clerk/nextjs/server dependency)
// so loading ingest-source.ts doesn't also pull in its dispatchCompile ->
// ~/server/compile/dispatch import chain, which this test has no need of.
vi.mock("./ingest-source", () => ({
  resolveCapturedByName: mocks.resolveCapturedByName,
}));

beforeEach(() => {
  mocks.insertValues.mockReturnValue({
    returning: mocks.returning,
    onConflictDoNothing: mocks.onConflictDoNothing,
  });
  mocks.onConflictDoNothing.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ id: "job_1" }]);
  mocks.updateSet.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  mocks.deleteWhere.mockResolvedValue(undefined);
  mocks.presignPutUrl.mockResolvedValue("https://s3/upload");
  mocks.headObject.mockResolvedValue(true);
  mocks.putObject.mockResolvedValue(undefined);
  mocks.dispatchExtract.mockResolvedValue(undefined);
  mocks.resolveCapturedByName.mockResolvedValue("Ada Lovelace");
});

describe("ingestBinaryBytes", () => {
  it("stores connector bytes with provenance and dispatches extraction", async () => {
    mocks.selectLimit.mockResolvedValue([]);
    mocks.returning.mockResolvedValue([{ id: "src_drive" }]);

    const result = await ingestBinaryBytes(
      {
        kind: "file",
        bytes: new Uint8Array([1, 2, 3]),
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 3,
        originalFilename: "Handbook.docx",
        title: "Handbook",
        idempotencyKey: "google_drive:conn:file:version",
        connectionId: "conn",
        externalId: "file",
        metadata: { provider: "google_drive" },
        skipIfDuplicate: true,
      },
      CTX,
    );

    expect(result.status).toBe("extracting");
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "extracting",
        connectionId: "conn",
        externalId: "file",
        originalFilename: "Handbook.docx",
      }),
    );
    expect(mocks.putObject).toHaveBeenCalledWith(
      "original/key.docx",
      new Uint8Array([1, 2, 3]),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mocks.dispatchExtract).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1" }),
    );
  });

  it("removes its reservation when object storage fails so a crawl can retry", async () => {
    mocks.selectLimit.mockResolvedValue([]);
    mocks.returning.mockResolvedValue([{ id: "src_drive" }]);
    mocks.putObject.mockRejectedValueOnce(new Error("s3 unavailable"));

    await expect(
      ingestBinaryBytes(
        {
          kind: "file",
          bytes: new Uint8Array([1]),
          mimeType: "application/pdf",
          sizeBytes: 1,
          originalFilename: "Policy.pdf",
          idempotencyKey: "google_drive:conn:file:version",
          skipIfDuplicate: true,
        },
        CTX,
      ),
    ).rejects.toThrow("s3 unavailable");

    expect(mocks.deleteWhere).toHaveBeenCalled();
    expect(mocks.dispatchExtract).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.clearAllMocks());

const CTX = { workspaceId: "ws_1", userId: "user_1", targetFolderId: null };

describe("presignBinarySource", () => {
  it("inserts an uploading source and returns the presigned URL", async () => {
    const result = await presignBinarySource(
      {
        kind: "screenshot",
        mimeType: "image/png",
        title: "A page",
        sizeBytes: 1024,
      },
      CTX,
    );

    expect(result.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.uploadUrl).toBe("https://s3/upload");
    expect(mocks.originalSource).toHaveBeenCalledWith(
      "ws_1",
      result.sourceId,
      "png",
    );
    expect(mocks.presignPutUrl).toHaveBeenCalledWith(
      "original/key.png",
      "image/png",
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.sourceId,
        kind: "screenshot",
        mimeType: "image/png",
        status: "uploading",
        s3KeyOriginal: "original/key.png",
        capturedByName: "Ada Lovelace",
        targetFolderId: null,
      }),
    );
  });

  it("stores a non-null targetFolderId on the source row", async () => {
    const folderId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const result = await presignBinarySource(
      { kind: "screenshot", mimeType: "image/png", sizeBytes: 512 },
      { ...CTX, targetFolderId: folderId },
    );
    expect(result.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ targetFolderId: folderId }),
    );
  });

  it("rejects a mime that does not match the kind", async () => {
    await expect(
      presignBinarySource(
        { kind: "voice", mimeType: "image/png", sizeBytes: 10 },
        CTX,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload", async () => {
    await expect(
      presignBinarySource(
        {
          kind: "screenshot",
          mimeType: "image/png",
          sizeBytes: 16 * 1024 * 1024,
        },
        CTX,
      ),
    ).rejects.toBeInstanceOf(BinaryIngestError);
  });

  it("derives the file kind's extension from originalFilename", async () => {
    const result = await presignBinarySource(
      {
        kind: "file",
        mimeType: "text/csv",
        sizeBytes: 100,
        originalFilename: "expenses.CSV",
      },
      CTX,
    );
    expect(mocks.originalSource).toHaveBeenCalledWith(
      "ws_1",
      result.sourceId,
      "csv",
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ originalFilename: "expenses.CSV" }),
    );
  });

  it("rejects a file kind with no originalFilename", async () => {
    await expect(
      presignBinarySource(
        { kind: "file", mimeType: "text/plain", sizeBytes: 10 },
        CTX,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("finalizeBinarySource", () => {
  it("flips to extracting and dispatches an extract job", async () => {
    mocks.selectLimit.mockResolvedValue([
      { id: "src_1", status: "uploading", s3KeyOriginal: "original/key.png" },
    ]);
    const result = await finalizeBinarySource("src_1", CTX);

    expect(result).toEqual({ sourceId: "src_1", status: "extracting" });
    expect(mocks.headObject).toHaveBeenCalledWith("original/key.png");
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "extracting" });
    expect(mocks.dispatchExtract).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", sourceId: "src_1" }),
    );
  });

  it("409s when the object never landed and stays uploading", async () => {
    mocks.selectLimit.mockResolvedValue([
      { id: "src_1", status: "uploading", s3KeyOriginal: "original/key.png" },
    ]);
    mocks.headObject.mockResolvedValue(false);
    await expect(finalizeBinarySource("src_1", CTX)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.dispatchExtract).not.toHaveBeenCalled();
  });

  it("is a no-op for a source already past uploading", async () => {
    mocks.selectLimit.mockResolvedValue([
      { id: "src_1", status: "queued", s3KeyOriginal: "original/key.png" },
    ]);
    const result = await finalizeBinarySource("src_1", CTX);
    expect(result.status).toBe("extracting");
    expect(mocks.dispatchExtract).not.toHaveBeenCalled();
  });

  it("404s on an unknown source", async () => {
    mocks.selectLimit.mockResolvedValue([]);
    await expect(finalizeBinarySource("nope", CTX)).rejects.toMatchObject({
      status: 404,
    });
  });
});
