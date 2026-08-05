import { beforeEach, describe, expect, it, vi } from "vitest";

import { runBrainInitJob } from "./init";

const mocks = vi.hoisted(() => ({
  draftCompanyMd: vi.fn(() => Promise.resolve("# Acme")),
  enrichCompanyWebsite: vi.fn(() =>
    Promise.resolve({
      title: "Acme Corporation",
      description: "Acme builds anvils.",
      logoUrl: null as string | null,
      siteText: "Acme builds anvils.",
    }),
  ),
  upsert: vi.fn(() => Promise.resolve({ id: "node-1" })),
  ingestSource: vi.fn(() => Promise.resolve({ sourceId: "src-1" })),
  workspaceRow: vi.fn(),
  update: vi.fn((_values: Record<string, unknown>): undefined => undefined),
}));

vi.mock("@acme/runtime/biographer", () => ({
  COMPANY_MD_PATH: "company.md",
  draftCompanyMd: mocks.draftCompanyMd,
  enrichCompanyWebsite: mocks.enrichCompanyWebsite,
}));
vi.mock("@acme/runtime/memory/wiki-pg-provider", () => ({
  memoryProvider: { upsert: mocks.upsert },
}));
vi.mock("@acme/runtime/memory", () => ({
  toProviderContext: (x: unknown) => x,
}));
vi.mock("@acme/api/access", () => ({
  buildAccessContext: (args: { workspaceId: string; userId: string }) => args,
}));
vi.mock("~/server/ingest/ingest-source", () => ({
  ingestSource: mocks.ingestSource,
}));
vi.mock("@acme/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.workspaceRow })),
      })),
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => mocks.update(values),
      }),
    })),
  },
}));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.workspaceRow.mockResolvedValue([
    {
      id: "ws-1",
      name: "Acme",
      description: null,
      website: "https://acme.test",
      ownerUserId: "u-1",
    },
  ]);
});

describe("runBrainInitJob", () => {
  it("drafts company.md, ingests the website source, marks done", async () => {
    await runBrainInitJob({
      jobId: "j1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.test",
      identitySource: "website",
    });
    expect(mocks.enrichCompanyWebsite).toHaveBeenCalledWith(
      "https://acme.test",
    );
    expect(mocks.draftCompanyMd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme Corporation",
        description: "Acme builds anvils.",
        siteText: "Acme builds anvils.",
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme Corporation",
        description: "Acme builds anvils.",
      }),
    );
    expect(mocks.upsert).toHaveBeenCalled();
    expect(mocks.ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "web", sourceUrl: "https://acme.test" }),
      expect.anything(),
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ brainInitStatus: "done" }),
    );
  });

  it("still marks done when the website ingest fails (best-effort)", async () => {
    mocks.ingestSource.mockRejectedValueOnce(new Error("s3 down"));
    await runBrainInitJob({
      jobId: "j1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.test",
      identitySource: "manual",
    });
    expect(mocks.upsert).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ brainInitStatus: "done" }),
    );
  });

  it("preserves an explicitly supplied workspace title", async () => {
    await runBrainInitJob({
      jobId: "j1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.test",
      identitySource: "manual",
    });

    expect(mocks.draftCompanyMd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme" }),
    );
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme Corporation" }),
    );
  });

  it("preserves explicit identity fields while enriching unspecified ones", async () => {
    mocks.workspaceRow.mockResolvedValueOnce([
      {
        id: "ws-1",
        name: "Acme Custom",
        description: null,
        website: "https://acme.test",
        ownerUserId: "u-1",
      },
    ]);

    await runBrainInitJob({
      jobId: "j1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.test",
      identitySource: "website",
      identitySources: { title: "manual", description: "website" },
    });

    expect(mocks.draftCompanyMd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme Custom",
        description: "Acme builds anvils.",
      }),
    );
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme Corporation" }),
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Acme builds anvils." }),
    );
  });

  it("does not replace an explicit description with website enrichment", async () => {
    mocks.workspaceRow.mockResolvedValueOnce([
      {
        id: "ws-1",
        name: "Acme",
        description: "Manual description.",
        website: "https://acme.test",
        ownerUserId: "u-1",
      },
    ]);

    await runBrainInitJob({
      jobId: "j1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.test",
      identitySource: "website",
      identitySources: { title: "website", description: "manual" },
    });

    expect(mocks.draftCompanyMd).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Manual description." }),
    );
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: "Acme builds anvils." }),
    );
  });

  it("marks failed when the upsert throws", async () => {
    mocks.upsert.mockRejectedValueOnce(new Error("db down"));
    await runBrainInitJob({
      jobId: "j1",
      workspaceId: "ws-1",
      websiteUrl: null,
      identitySource: "manual",
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ brainInitStatus: "failed" }),
    );
  });

  it("skips website work when no websiteUrl", async () => {
    await runBrainInitJob({
      jobId: "j1",
      workspaceId: "ws-1",
      websiteUrl: null,
      identitySource: "manual",
    });
    expect(mocks.enrichCompanyWebsite).not.toHaveBeenCalled();
    expect(mocks.ingestSource).not.toHaveBeenCalled();
  });
});
