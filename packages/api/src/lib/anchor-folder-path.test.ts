import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.fn();

vi.mock("@acme/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit }),
      }),
    }),
  },
}));

const { anchorFolderPath } = await import("./folders");

beforeEach(() => {
  vi.clearAllMocks();
});

// The distinction this pins down is a privilege boundary, not a nicety.
// `""` is the workspace root and the widest possible prefix — prefixCovers("",
// x) is true for every x — so returning it for a folder that no longer exists
// *widens* access instead of failing closed. Several call sites used to do
// `folder?.path ?? ""`, which meant soft-deleting a restricted folder silently
// promoted every agent/token/artifact anchored to it to workspace-root reach.
describe("anchorFolderPath", () => {
  it("treats a null folderId as the workspace root", async () => {
    await expect(anchorFolderPath("ws-1", null)).resolves.toBe("");
    // No query needed for the root case.
    expect(limit).not.toHaveBeenCalled();
  });

  it("returns the folder's path when it resolves", async () => {
    limit.mockResolvedValueOnce([{ path: "teams/acme" }]);
    await expect(anchorFolderPath("ws-1", "folder-1")).resolves.toBe(
      "teams/acme",
    );
  });

  it("returns null — not root — when the folder is missing or deleted", async () => {
    limit.mockResolvedValueOnce([]);
    await expect(anchorFolderPath("ws-1", "folder-gone")).resolves.toBeNull();
  });

  it("never widens a deleted folder to the root prefix", async () => {
    limit.mockResolvedValueOnce([]);
    const path = await anchorFolderPath("ws-1", "folder-gone");
    expect(path).not.toBe("");
  });
});
