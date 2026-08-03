import { describe, expect, it } from "vitest";

import type { ConnectionSummary } from "@acme/validators/cli";

import { collectSyncRequests, connectionIdsForProvider } from "./run";

function connection(
  id: string,
  provider: string,
  status = "active",
): ConnectionSummary {
  return {
    id,
    provider,
    displayName: provider,
    status,
    targetFolderId: null,
    folderPath: null,
    config: null,
    intervalSeconds: 86400,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    nextRunAt: null,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("sync all outcomes", () => {
  it("preserves successful run ids when a sibling enqueue fails", () => {
    const result = collectSyncRequests(
      ["connection-1", "connection-2"],
      [
        {
          status: "fulfilled",
          value: {
            connectionId: "connection-1",
            runId: "00000000-0000-4000-8000-000000000001",
          },
        },
        {
          status: "rejected",
          reason: new Error("provider unavailable"),
        },
      ],
    );

    expect(result).toEqual({
      requested: [
        {
          connectionId: "connection-1",
          runId: "00000000-0000-4000-8000-000000000001",
        },
      ],
      failures: [
        {
          connectionId: "connection-2",
          stage: "enqueue",
          error: "provider unavailable",
        },
      ],
    });
  });

  it("resolves the single active connection behind a provider name", () => {
    const connectorId = "00000000-0000-4000-8000-000000000001";
    expect(
      connectionIdsForProvider(
        [
          connection(connectorId, "acme/issues"),
          connection(
            "00000000-0000-4000-8000-000000000002",
            "acme/docs",
            "paused",
          ),
        ],
        "acme/issues",
      ),
    ).toEqual([connectorId]);
  });

  it("fails closed if a provider name is ambiguous", () => {
    expect(() =>
      connectionIdsForProvider(
        [
          connection("00000000-0000-4000-8000-000000000001", "acme/issues"),
          connection("00000000-0000-4000-8000-000000000002", "acme/issues"),
        ],
        "acme/issues",
      ),
    ).toThrow("More than one active acme/issues connection exists");
  });
});
