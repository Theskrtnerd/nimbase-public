import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteProviderConnection,
  linkProviderSourceHistoryToResource,
  mirrorProviderAccessResources,
  persistSourceProviderAccessPolicy,
  providerAccessResourceKey,
} from "./provider-access";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  returningResults: [] as unknown[][],
  insertCalls: [] as { table: unknown; values: unknown }[],
  updateSets: [] as unknown[],
  updateResults: [] as { id: string }[][],
  batch: vi.fn(),
}));

vi.mock("@acme/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve(mocks.selectResults.shift() ?? []),
            ),
          })),
        })),
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve(mocks.selectResults.shift() ?? []),
          ),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        mocks.insertCalls.push({ table, values });
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(() =>
              Promise.resolve(mocks.returningResults.shift() ?? []),
            ),
          })),
        };
      }),
      select: vi.fn((query: unknown) => {
        mocks.insertCalls.push({ table, values: query });
        return { query };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSets.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() =>
              Promise.resolve(
                mocks.updateResults.shift() ?? [{ id: "resource-1" }],
              ),
            ),
          })),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
    batch: mocks.batch,
  },
}));

const connection = {
  provider: "example/issues",
  tenantId: "tenant-1",
  status: "active",
};
const observation = {
  kind: "project",
  externalId: "PROJECT-1",
  state: "active" as const,
  accessPolicy: {
    visibility: "workspace" as const,
    completeness: "complete" as const,
    grants: [],
  },
};

describe("provider access resource mirroring", () => {
  beforeEach(() => {
    mocks.selectResults.length = 0;
    mocks.returningResults.length = 0;
    mocks.insertCalls.length = 0;
    mocks.updateSets.length = 0;
    mocks.updateResults.length = 0;
    mocks.batch.mockReset().mockResolvedValue([]);
  });

  it("canonicalizes resource kinds without changing opaque external ids", () => {
    expect(
      providerAccessResourceKey({
        kind: " Project ",
        externalId: " Case-Sensitive-ID ",
      }),
    ).toBe('["project","Case-Sensitive-ID"]');
  });

  it("refuses observations for an inactive connection", async () => {
    mocks.selectResults.push([{ ...connection, status: "paused" }]);

    await expect(
      mirrorProviderAccessResources({
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        observations: [observation],
      }),
    ).rejects.toMatchObject({ code: "connection_inactive" });
    expect(mocks.insertCalls).toHaveLength(0);
  });

  it("rejects locally invented user-profile grants", async () => {
    await expect(
      persistSourceProviderAccessPolicy({
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        externalId: "ITEM-1",
        definition: {
          version: 1,
          provider: "example/issues",
          tenantId: "tenant-1",
          visibility: "restricted",
          completeness: "partial",
          grants: [
            {
              type: "user_profile",
              userProfileId: "00000000-0000-4000-8000-000000000001",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_policy" });
    expect(mocks.insertCalls).toHaveLength(0);
  });

  it("appends the initial policy observation", async () => {
    mocks.selectResults.push([connection], []);
    mocks.returningResults.push([{ id: "policy-1" }]);

    const result = await mirrorProviderAccessResources({
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      observations: [observation],
      observedAt: new Date("2026-08-06T00:00:00.000Z"),
    });

    const resourceInsert = mocks.insertCalls[1]?.values as
      | { id?: string }
      | undefined;
    expect(resourceInsert?.id).toEqual(expect.any(String));
    expect(result.get('["project","PROJECT-1"]')).toMatchObject({
      resourceId: resourceInsert?.id,
      state: "active",
      accessPolicy: { policyId: "policy-1" },
    });
    expect(mocks.insertCalls).toHaveLength(3);
    expect(mocks.insertCalls.at(-1)?.values).toMatchObject({
      workspaceId: "workspace-1",
      resourceId: resourceInsert?.id,
      state: "active",
      accessPolicyId: "policy-1",
    });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("refreshes an identical policy without appending history", async () => {
    mocks.selectResults.push(
      [connection],
      [{ id: "policy-1" }],
      [
        {
          id: "resource-1",
          state: "active",
          currentAccessPolicyId: "policy-1",
        },
      ],
    );
    mocks.returningResults.push([]);

    await mirrorProviderAccessResources({
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      observations: [observation],
      observedAt: new Date("2026-08-06T01:00:00.000Z"),
    });

    expect(mocks.insertCalls).toHaveLength(1);
    expect(mocks.updateSets).toHaveLength(1);
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("appends history when the effective policy changes", async () => {
    mocks.selectResults.push(
      [connection],
      [
        {
          id: "resource-1",
          state: "active",
          currentAccessPolicyId: "policy-1",
        },
      ],
    );
    mocks.returningResults.push([{ id: "policy-2" }]);
    mocks.batch.mockResolvedValueOnce([[{ id: "resource-1" }], []]);

    await mirrorProviderAccessResources({
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      observations: [
        {
          ...observation,
          accessPolicy: {
            visibility: "restricted",
            completeness: "complete",
            grants: [],
          },
        },
      ],
      observedAt: new Date("2026-08-06T02:00:00.000Z"),
    });

    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.updateSets).toContainEqual({
      name: undefined,
      state: "active",
      currentAccessPolicyId: "policy-2",
      lastVerifiedAt: new Date("2026-08-06T02:00:00.000Z"),
      updatedAt: new Date("2026-08-06T02:00:00.000Z"),
    });
  });

  it("rebinds historical captures without changing their policy snapshots", async () => {
    await linkProviderSourceHistoryToResource({
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      sourceExternalId: "ISSUE-1",
      resourceId: "resource-2",
    });

    expect(mocks.updateSets).toEqual([{ accessResourceId: "resource-2" }]);
  });

  it("atomically revokes active resources before deleting a connection", async () => {
    const observedAt = new Date("2026-08-06T03:00:00.000Z");

    await deleteProviderConnection({
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      observedAt,
    });

    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch.mock.calls[0]?.[0]).toHaveLength(3);
    expect(mocks.updateSets).toContainEqual({
      connectionId: null,
      state: "inaccessible",
      currentAccessPolicyId: null,
      lastVerifiedAt: observedAt,
      updatedAt: observedAt,
    });
  });
});
