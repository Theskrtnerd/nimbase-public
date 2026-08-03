import { beforeEach, describe, expect, it, vi } from "vitest";

import { getNoteForAccess } from "./get-note";

// Hoisted so the vi.mock factories (which run before the module body) can close
// over the same mocks + a stand-in ToolsetForbiddenError the adapter can
// `instanceof`-check.
const h = vi.hoisted(() => {
  class ToolsetForbiddenError extends Error {}
  return {
    fetchMock: vi.fn(),
    loadNodeSourcesMock: vi.fn(),
    ToolsetForbiddenError,
  };
});

vi.mock("@acme/cloud", () => ({
  toProviderContext: () => ({}),
  ToolsetForbiddenError: h.ToolsetForbiddenError,
}));
vi.mock("@acme/cloud/memory/wiki-pg-provider", () => ({
  memoryProvider: { fetch: h.fetchMock },
}));
vi.mock("@acme/api/node-metadata", () => ({
  loadNodeSources: h.loadNodeSourcesMock,
}));

const access = {
  workspaceId: "ws1",
  userId: "u1",
  scopes: () => null,
} as unknown as Parameters<typeof getNoteForAccess>[0];

beforeEach(() => {
  h.fetchMock.mockReset();
  h.loadNodeSourcesMock.mockReset();
});

describe("getNoteForAccess", () => {
  it("maps provider fetch + rich provenance onto the exact note wire shape", async () => {
    const updatedAt = new Date("2026-07-03T12:00:00.000Z");
    h.fetchMock.mockResolvedValue({
      id: "n1",
      kind: "note",
      title: "Q3 plan",
      content: "# Q3\n\nbody",
      metadata: { path: "sales/q3" },
      labels: ["sales", "wip"],
      sources: [],
      summary: "one-liner",
      updatedAt,
    });
    const sources = [
      {
        id: "src1",
        kind: "web",
        title: "Origin",
        sourceUrl: "https://example.com",
        capturedAt: updatedAt,
      },
    ];
    h.loadNodeSourcesMock.mockResolvedValue(sources);

    const out = await getNoteForAccess(access, "n1");

    expect(out).toEqual({
      id: "n1",
      path: "sales/q3",
      type: "Note",
      title: "Q3 plan",
      body: "# Q3\n\nbody",
      summary: "one-liner",
      updatedAt,
      tags: ["sales", "wip"],
      sources,
    });
  });

  it("defaults summary/updatedAt to null when the node omits them", async () => {
    h.fetchMock.mockResolvedValue({
      id: "n1",
      kind: "note",
      title: "t",
      content: "b",
      metadata: { path: "p" },
      labels: [],
      sources: [],
    });
    h.loadNodeSourcesMock.mockResolvedValue([]);

    const out = await getNoteForAccess(access, "n1");
    expect(out).toMatchObject({ summary: null, updatedAt: null });
  });

  it("returns null when the node is not found / not readable", async () => {
    h.fetchMock.mockResolvedValue(null);
    h.loadNodeSourcesMock.mockResolvedValue([]);
    expect(await getNoteForAccess(access, "n1")).toBeNull();
  });

  it("returns null (not-found) when the kernel gate forbids an empty read scope", async () => {
    h.fetchMock.mockRejectedValue(new h.ToolsetForbiddenError("read"));
    h.loadNodeSourcesMock.mockResolvedValue([]);
    expect(await getNoteForAccess(access, "n1")).toBeNull();
  });
});
