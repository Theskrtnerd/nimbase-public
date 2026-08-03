import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AcmeApiAccess from "@acme/api/access";

const rows = vi.fn<() => Promise<{ folderPath: string }[]>>();
const loadRestrictedPaths = vi.fn<() => Promise<string[]>>();

vi.mock("@acme/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => rows() }),
      }),
    }),
  },
}));

vi.mock("@acme/api/access", async (original) => {
  const actual = await original<typeof AcmeApiAccess>();
  return { ...actual, loadRestrictedPaths };
});

const { resolveDocSiteFence } = await import("./fence");

beforeEach(() => {
  rows.mockReset();
  loadRestrictedPaths.mockReset();
  loadRestrictedPaths.mockResolvedValue([]);
});

describe("resolveDocSiteFence", () => {
  it("uses the centralized KB root when no folder is configured", async () => {
    loadRestrictedPaths.mockResolvedValue(["private"]);

    await expect(resolveDocSiteFence("workspace-1", null)).resolves.toEqual({
      scopes: [{ prefix: "", exclude: ["private"] }],
      prefix: "",
    });
    expect(rows).not.toHaveBeenCalled();
  });

  it("fails closed when a configured folder is unavailable", async () => {
    rows.mockResolvedValue([]);

    await expect(
      resolveDocSiteFence("workspace-1", "folder-1"),
    ).resolves.toEqual({
      scopes: [],
      prefix: "",
    });
  });
});
