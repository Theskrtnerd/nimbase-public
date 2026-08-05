import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(() => Promise.resolve()),
  insertValues: vi.fn(() => Promise.resolve()),
  chunkMarkdown: vi.fn((text: string) =>
    text ? [{ ord: 0, breadcrumb: "", text }] : [],
  ),
  embedChunks: vi.fn(() =>
    Promise.resolve({ embeddings: [[0.1, 0.2]], tokens: 10 }),
  ),
}));

vi.mock("@acme/db", () => ({ eq: vi.fn() }));
vi.mock("@acme/db/client", () => ({
  db: {
    delete: () => ({ where: mocks.deleteWhere }),
    insert: () => ({ values: mocks.insertValues }),
  },
}));
vi.mock("@acme/db/schema", () => ({ WikiChunk: {}, SpendLedger: {} }));
vi.mock("./chunk", () => ({ chunkMarkdown: mocks.chunkMarkdown }));
vi.mock("./embed", () => ({ embedChunks: mocks.embedChunks }));

const { indexNodeVersion } = await import("./index-node-version");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chunkMarkdown.mockImplementation((text: string) =>
    text ? [{ ord: 0, breadcrumb: "", text }] : [],
  );
  mocks.embedChunks.mockResolvedValue({ embeddings: [[0.1, 0.2]], tokens: 10 });
});

describe("indexNodeVersion", () => {
  it("chunks a note from its body", async () => {
    await indexNodeVersion({
      nodeVersionId: "v1",
      workspaceId: "ws_1",
      kind: "note",
      body: "# Title\nhello world",
    });
    expect(mocks.chunkMarkdown).toHaveBeenCalledWith("# Title\nhello world");
  });

  it("does not embed OKF frontmatter or volatile server timestamps", async () => {
    await indexNodeVersion({
      nodeVersionId: "v1",
      workspaceId: "ws_1",
      kind: "note",
      body: `---
title: Roadmap
updatedAt: 2026-08-05T00:00:00.000Z
tags:
  - planning
---
# Roadmap
hello world`,
    });
    expect(mocks.chunkMarkdown).toHaveBeenCalledWith("# Roadmap\nhello world");
  });

  it("defaults to note behavior (chunks the body) when kind is omitted", async () => {
    await indexNodeVersion({
      nodeVersionId: "v1",
      workspaceId: "ws_1",
      body: "plain body",
    });
    expect(mocks.chunkMarkdown).toHaveBeenCalledWith("plain body");
  });

  it("chunks a dataset from its summary, not the raw JSON body", async () => {
    await indexNodeVersion({
      nodeVersionId: "v1",
      workspaceId: "ws_1",
      kind: "dataset",
      body: '[{"date":"2026-06-01","steps":9000}]',
      summary: "daily step counts, June 2026",
    });
    expect(mocks.chunkMarkdown).toHaveBeenCalledWith(
      "daily step counts, June 2026",
    );
  });

  it("treats a missing summary as empty for datasets rather than falling back to the body", async () => {
    await indexNodeVersion({
      nodeVersionId: "v1",
      workspaceId: "ws_1",
      kind: "dataset",
      body: '[{"date":"2026-06-01","steps":9000}]',
    });
    expect(mocks.chunkMarkdown).toHaveBeenCalledWith("");
  });

  it("skips embedding and insert when there are no chunks", async () => {
    mocks.chunkMarkdown.mockReturnValue([]);
    await indexNodeVersion({
      nodeVersionId: "v1",
      workspaceId: "ws_1",
      kind: "dataset",
      body: "{}",
      summary: "",
    });
    expect(mocks.embedChunks).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
