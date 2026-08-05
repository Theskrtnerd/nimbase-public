import { beforeEach, describe, expect, it, vi } from "vitest";

import { ingestItems } from "./run";

const mocks = vi.hoisted(() => ({
  mirrorResources: vi.fn(),
  resolveResource: vi.fn(),
  linkHistory: vi.fn(),
  ingestSource: vi.fn(),
}));

vi.mock("@acme/api/provider-access", () => ({
  mirrorProviderAccessResources: mocks.mirrorResources,
  providerAccessResourceKey: (resource: { kind: string; externalId: string }) =>
    `${resource.kind}:${resource.externalId}`,
  resolveProviderAccessResource: mocks.resolveResource,
  linkProviderSourceHistoryToResource: mocks.linkHistory,
}));
vi.mock("../ingest/ingest-source", () => ({
  ingestSource: mocks.ingestSource,
}));

const connection = {
  id: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
  workspaceId: "workspace-1",
  provider: "example/issues",
  routeKey: "tenant-1",
  createdByUserId: "user-1",
  targetFolderId: null,
  cursor: null,
} as Parameters<typeof ingestItems>[0];

const accessPolicy = {
  policyId: "policy-1",
  fingerprint: "policy-fingerprint",
  definition: {
    version: 1 as const,
    provider: "example/issues",
    tenantId: "tenant-1",
    visibility: "restricted" as const,
    completeness: "complete" as const,
    grants: [{ type: "email" as const, email: "ada@example.com" }],
  },
};

function item(externalId: string) {
  return {
    externalId,
    title: `Issue ${externalId}`,
    markdown: `# Issue ${externalId}`,
    updatedAt: "2026-08-06T00:00:00.000Z",
    contentHash: `revision-${externalId}`,
    kind: "web" as const,
    accessResource: { kind: "project", externalId: "PROJECT-1" },
  };
}

describe("crawl ACL resource mirroring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mirrorResources.mockResolvedValue(new Map());
    mocks.ingestSource.mockResolvedValue({
      sourceId: "source-1",
      status: "held",
    });
    mocks.linkHistory.mockResolvedValue(undefined);
  });

  it("persists an ACL-only response without ingesting content", async () => {
    const outcome = await ingestItems(
      connection,
      [],
      [
        {
          kind: "project",
          externalId: "PROJECT-1",
          state: "active",
          accessPolicy: {
            visibility: "restricted",
            completeness: "complete",
            grants: [{ type: "email", email: "ada@example.com" }],
          },
        },
      ],
      null,
      false,
    );

    expect(mocks.mirrorResources).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      connectionId: connection.id,
      observations: [
        {
          kind: "project",
          externalId: "PROJECT-1",
          state: "active",
          accessPolicy: {
            visibility: "restricted",
            completeness: "complete",
            grants: [{ type: "email", email: "ada@example.com" }],
          },
        },
      ],
    });
    expect(mocks.ingestSource).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ingested: 0, skipped: 0, seen: 0 });
  });

  it("reuses one mirrored ACL resource across multiple content items", async () => {
    mocks.mirrorResources.mockResolvedValue(
      new Map([
        [
          "project:PROJECT-1",
          {
            resourceId: "resource-1",
            state: "active",
            accessPolicy,
          },
        ],
      ]),
    );

    await ingestItems(
      connection,
      [item("ISSUE-1"), item("ISSUE-2")],
      [
        {
          kind: "project",
          externalId: "PROJECT-1",
          state: "active",
          accessPolicy: {
            visibility: "restricted",
            completeness: "complete",
            grants: [],
          },
        },
      ],
      null,
      false,
    );

    expect(mocks.resolveResource).not.toHaveBeenCalled();
    expect(mocks.linkHistory).toHaveBeenCalledTimes(2);
    expect(mocks.linkHistory).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      connectionId: connection.id,
      sourceExternalId: "ISSUE-1",
      resourceId: "resource-1",
    });
    expect(mocks.ingestSource).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.ingestSource.mock.calls) {
      expect(input).toMatchObject({
        providerAccess: { resourceId: "resource-1", ...accessPolicy },
      });
    }
  });

  it("translates a legacy item policy into the shared resource path", async () => {
    mocks.mirrorResources.mockResolvedValue(
      new Map([
        [
          "item:ISSUE-1",
          {
            resourceId: "resource-legacy",
            state: "active",
            accessPolicy,
          },
        ],
      ]),
    );
    const { accessResource: _accessResource, ...legacyItem } = item("ISSUE-1");

    await ingestItems(
      connection,
      [
        {
          ...legacyItem,
          accessPolicy: {
            visibility: "restricted",
            completeness: "complete",
            grants: [],
          },
        },
      ],
      [],
      null,
      false,
    );

    expect(mocks.mirrorResources).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            kind: "item",
            externalId: "ISSUE-1",
            state: "active",
          }),
        ],
      }),
    );
    expect(mocks.ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({
        providerAccess: {
          resourceId: "resource-legacy",
          ...accessPolicy,
        },
      }),
      expect.any(Object),
    );
    expect(mocks.ingestSource.mock.calls[0]?.[0]).not.toHaveProperty(
      "providerAccessPolicy",
    );
  });

  it("resolves a previously mirrored resource once per pull", async () => {
    mocks.resolveResource.mockResolvedValue({
      resourceId: "resource-1",
      ...accessPolicy,
    });

    await ingestItems(
      connection,
      [item("ISSUE-1"), item("ISSUE-2")],
      [],
      null,
      false,
    );

    expect(mocks.resolveResource).toHaveBeenCalledTimes(1);
    expect(mocks.ingestSource).toHaveBeenCalledTimes(2);
  });

  it("rejects content linked to an inaccessible resource", async () => {
    mocks.mirrorResources.mockResolvedValue(
      new Map([
        [
          "project:PROJECT-1",
          {
            resourceId: "resource-1",
            state: "inaccessible",
            accessPolicy: null,
          },
        ],
      ]),
    );

    await expect(
      ingestItems(
        connection,
        [item("ISSUE-1")],
        [
          {
            kind: "project",
            externalId: "PROJECT-1",
            state: "inaccessible",
          },
        ],
        null,
        false,
      ),
    ).rejects.toThrow("inactive access resource");
    expect(mocks.ingestSource).not.toHaveBeenCalled();
  });
});
