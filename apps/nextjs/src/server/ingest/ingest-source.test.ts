import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ingestSource } from "./ingest-source";

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  returning: vi.fn(),
  putObject: vi.fn(),
  originalSource: vi.fn(() => "original/key.md"),
  rawMdSource: vi.fn(() => "raw/key.md"),
  buildRawMd: vi.fn(() => "---\nkind: web\n---\n\nhello"),
  dispatchCompile: vi.fn(),
  getUser: vi.fn(),
  updateWhere: vi.fn(),
  updateSet: vi.fn(),
  persistSourceProviderAccessPolicy: vi.fn(),
}));

vi.mock("@acme/db/client", () => ({
  db: {
    insert: vi.fn(() => ({ values: mocks.insertValues })),
    update: vi.fn(() => ({ set: mocks.updateSet })),
  },
}));
vi.mock("@acme/cloud", () => ({
  s3: {
    s3KeyFor: {
      originalSource: mocks.originalSource,
      rawMdSource: mocks.rawMdSource,
    },
    putObject: mocks.putObject,
  },
  buildRawMd: mocks.buildRawMd,
}));
vi.mock("@acme/api/provider-access", () => ({
  persistSourceProviderAccessPolicy: mocks.persistSourceProviderAccessPolicy,
}));
vi.mock("~/server/compile/dispatch", () => ({
  dispatchCompile: mocks.dispatchCompile,
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ users: { getUser: mocks.getUser } }),
}));

beforeEach(() => {
  // The Source insert is awaited directly; the CompileJob insert chains
  // `.returning()`. One mock serves both shapes.
  mocks.insertValues.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ id: "job_1" }]);
  mocks.putObject.mockResolvedValue(undefined);
  mocks.getUser.mockResolvedValue({ fullName: "Ada Lovelace" });
  mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.persistSourceProviderAccessPolicy.mockResolvedValue({
    id: "policy-1",
    fingerprint: "policy-fingerprint",
    definition: {
      version: 1,
      provider: "gmail",
      tenantId: "ada@example.com",
      visibility: "restricted",
      completeness: "complete",
      grants: [],
    },
  });
});

afterEach(() => vi.clearAllMocks());

describe("ingestSource", () => {
  it("creates a source, stores the original + raw.md, and dispatches a compile job", async () => {
    const result = await ingestSource(
      { kind: "web", sourceUrl: "https://ex.com", text: "hello" },
      { workspaceId: "ws_1", userId: "user_1", targetFolderId: null },
    );

    // The id is generated in code so the S3 keys are known before the insert.
    expect(result.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.status).toBe("queued");
    expect(mocks.originalSource).toHaveBeenCalledWith(
      "ws_1",
      result.sourceId,
      "md",
    );
    expect(mocks.rawMdSource).toHaveBeenCalledWith("ws_1", result.sourceId);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.sourceId,
        s3KeyOriginal: "original/key.md",
        s3KeyRawMd: "raw/key.md",
        contentHash: expect.any(String) as string,
        capturedByName: "Ada Lovelace",
        targetFolderId: null,
      }),
    );
    expect(mocks.putObject).toHaveBeenCalledWith(
      "original/key.md",
      "hello",
      "text/markdown",
    );
    expect(mocks.putObject).toHaveBeenCalledWith(
      "raw/key.md",
      "---\nkind: web\n---\n\nhello",
      "text/markdown",
    );
    expect(mocks.dispatchCompile).toHaveBeenCalledWith({
      jobId: "job_1",
      workspaceId: "ws_1",
      sourceId: result.sourceId,
    });
  });

  it("stores the targetFolderId on the source row", async () => {
    const folderId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const result = await ingestSource(
      { kind: "highlight", text: "snip" },
      { workspaceId: "ws_1", userId: "user_1", targetFolderId: folderId },
    );

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ targetFolderId: folderId }),
    );
    expect(result.status).toBe("queued");
  });

  it("holds restricted provider evidence without creating a compile job", async () => {
    const policy = {
      version: 1 as const,
      provider: "gmail",
      tenantId: "ada@example.com",
      visibility: "restricted" as const,
      completeness: "complete" as const,
      grants: [{ type: "email" as const, email: "ada@example.com" }],
    };
    const result = await ingestSource(
      {
        kind: "chat_export",
        text: "private mail",
        idempotencyKey: "gmail-thread-1",
        connectionId: "connection-1",
        externalId: "thread-1",
        providerAccessPolicy: policy,
      },
      { workspaceId: "ws_1", userId: "user_1", targetFolderId: null },
    );

    expect(result.status).toBe("held");
    expect(mocks.persistSourceProviderAccessPolicy).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      actorUserId: "user_1",
      connectionId: "connection-1",
      externalId: "thread-1",
      definition: policy,
    });
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "held",
        accessPolicyId: "policy-1",
        idempotencyKey: "gmail-thread-1:policy-fingerprint",
      }),
    );
    expect(mocks.dispatchCompile).not.toHaveBeenCalled();
  });

  it("also holds workspace-visible provider evidence until memory evals exist", async () => {
    const policy = {
      version: 1 as const,
      provider: "slack",
      tenantId: "T1",
      visibility: "workspace" as const,
      completeness: "complete" as const,
      grants: [],
    };
    mocks.persistSourceProviderAccessPolicy.mockResolvedValueOnce({
      id: "policy-public",
      fingerprint: "public-fingerprint",
      definition: policy,
    });

    const result = await ingestSource(
      {
        kind: "chat_export",
        text: "public channel thread",
        connectionId: "connection-1",
        externalId: "thread-2",
        providerAccessPolicy: policy,
      },
      { workspaceId: "ws_1", userId: "user_1", targetFolderId: null },
    );

    expect(result.status).toBe("held");
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "held",
        accessPolicyId: "policy-public",
      }),
    );
    expect(mocks.dispatchCompile).not.toHaveBeenCalled();
  });

  it("propagates a failed source insert and never dispatches", async () => {
    mocks.insertValues.mockImplementationOnce(() =>
      Promise.reject(new Error("db_down")),
    );
    await expect(
      ingestSource(
        { kind: "web" },
        { workspaceId: "ws_1", userId: null, targetFolderId: null },
      ),
    ).rejects.toThrow("db_down");
    expect(mocks.dispatchCompile).not.toHaveBeenCalled();
  });

  it("marks the source and job failed when the compile enqueue throws", async () => {
    // A QStash outage used to leave the Source at "queued" behind an orphan
    // CompileJob that nothing would ever run. Both rows must end up visibly
    // failed.
    mocks.dispatchCompile.mockRejectedValueOnce(new Error("qstash_down"));

    await expect(
      ingestSource(
        { kind: "web", text: "hello" },
        { workspaceId: "ws_1", userId: "user_1", targetFolderId: null },
      ),
    ).rejects.toThrow("qstash_down");

    // Both rows, in the order the Promise.all builds them: CompileJob (which
    // also stamps finishedAt), then Source.
    expect(mocks.updateSet).toHaveBeenCalledTimes(2);
    expect(mocks.updateSet).toHaveBeenNthCalledWith(1, {
      status: "failed",
      error: "enqueue failed: qstash_down",
      finishedAt: expect.any(Date) as Date,
    });
    expect(mocks.updateSet).toHaveBeenNthCalledWith(2, {
      status: "failed",
      error: "enqueue failed: qstash_down",
    });
  });
});
