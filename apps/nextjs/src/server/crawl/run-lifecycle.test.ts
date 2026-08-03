import { beforeEach, describe, expect, it, vi } from "vitest";

import { runCrawlJob } from "./run";

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn<(values: unknown) => void>(),
  conflict: vi.fn<(conflict: unknown) => void>(),
  runRow: vi.fn(),
  connectorAdapterFor: vi.fn(),
}));

vi.mock("@acme/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: "connection-1",
                workspaceId: "workspace-1",
                status: "active",
              },
            ]),
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => {
        mocks.insertValues(values);
        return {
          onConflictDoUpdate: (conflict: unknown) => {
            mocks.conflict(conflict);
            return { returning: mocks.runRow };
          },
        };
      },
    }),
  },
}));
vi.mock("./registry", () => ({
  connectorAdapterFor: mocks.connectorAdapterFor,
}));
vi.mock("../connection-secret", () => ({
  decryptConnectionSecret: vi.fn(),
}));
vi.mock("../ingest/ingest-source", () => ({
  ingestSource: vi.fn(),
}));

describe("crawl run lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps arbitrary delivery ids out of the UUID run key and ignores terminal redelivery", async () => {
    mocks.runRow.mockResolvedValue([]);

    await runCrawlJob({
      jobId: "connector-pull-1",
      runId: "00000000-0000-4000-8000-000000000001",
      connectionId: "connection-1",
      workspaceId: "workspace-1",
    });

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000001",
        connectionId: "connection-1",
      }),
    );
    const conflict = mocks.conflict.mock.calls[0]?.[0];
    expect(conflict).toBeTypeOf("object");
    expect(conflict).toHaveProperty("setWhere");
    expect(mocks.connectorAdapterFor).not.toHaveBeenCalled();
  });
});
