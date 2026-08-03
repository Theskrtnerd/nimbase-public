import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspace } from "./workspace-control";

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  insertedValues: [] as unknown[],
}));

vi.mock("@acme/db/client", () => ({
  db: {
    batch: mocks.batch,
    insert: mocks.insert,
    select: mocks.select,
  },
}));

describe("createWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedValues.length = 0;
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });
    mocks.insert.mockImplementation(() => ({
      values: (values: unknown) => {
        mocks.insertedValues.push(values);
        return {
          returning: () => ({ kind: "workspace-returning-query" }),
        };
      },
    }));
  });

  it("creates the workspace, owner membership, and default grant atomically", async () => {
    const enqueue = vi.fn(() => Promise.resolve());
    const workspace = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Acme",
      slug: "acme",
      description: null,
      website: "https://acme.example",
      brainInitStatus: "pending" as const,
      ownerUserId: "user-1",
      createdAt: new Date(),
      updatedAt: null,
    };
    mocks.batch.mockResolvedValue([[workspace], {}, {}, {}, {}, {}]);

    await expect(
      createWorkspace({
        input: { name: "Acme", website: "https://acme.example" },
        creator: {
          id: "user-1",
          name: "Ada",
          email: "ada@example.com",
        },
        brainInit: { enqueue },
        identitySources: { title: "website", description: "website" },
      }),
    ).resolves.toEqual(workspace);

    expect(enqueue).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      websiteUrl: "https://acme.example",
      identitySources: { title: "website", description: "website" },
    });

    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch.mock.calls[0]?.[0]).toHaveLength(6);
    const workspaceId = (mocks.insertedValues[0] as { id: string }).id;
    const userProfileId = (mocks.insertedValues[1] as { id: string }).id;
    expect(workspaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(mocks.insertedValues).toEqual([
      expect.objectContaining({
        id: workspaceId,
        name: "Acme",
        ownerUserId: "user-1",
        slug: "acme",
      }),
      expect.objectContaining({
        id: userProfileId,
        workspaceId,
        primaryEmail: "ada@example.com",
        displayName: "Ada",
      }),
      {
        workspaceId,
        userProfileId,
        email: "ada@example.com",
      },
      {
        workspaceId,
        userProfileId,
        provider: "clerk",
        tenantId: "nimbase",
        subject: "user-1",
        email: "ada@example.com",
        emailVerified: true,
      },
      {
        workspaceId,
        userId: "user-1",
        userProfileId,
        role: "owner",
        name: "Ada",
        email: "ada@example.com",
      },
      {
        workspaceId,
        principalType: "all_members",
        role: "contributor",
      },
    ]);
  });
});
