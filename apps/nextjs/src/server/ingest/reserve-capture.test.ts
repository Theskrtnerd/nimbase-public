import { beforeEach, describe, expect, it, vi } from "vitest";

import { findProviderResourceDuplicateSourceId } from "./reserve-capture";

const mocks = vi.hoisted(() => ({
  results: [] as { id: string }[][],
  where: vi.fn(),
}));

vi.mock("@acme/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: (condition: unknown) => {
          mocks.where(condition);
          return {
            limit: vi.fn(() => Promise.resolve(mocks.results.shift() ?? [])),
          };
        },
      })),
    })),
  },
}));
vi.mock("./ingest-source", () => ({
  resolveCapturedByName: vi.fn(),
}));

describe("provider resource capture deduplication", () => {
  beforeEach(() => {
    mocks.results.length = 0;
    mocks.where.mockReset();
  });

  it("uses the stable resource key when it already exists", async () => {
    mocks.results.push([{ id: "source-current" }]);

    await expect(
      findProviderResourceDuplicateSourceId(
        "workspace-1",
        "provider:connection:item:revision",
      ),
    ).resolves.toBe("source-current");
    expect(mocks.where).toHaveBeenCalledTimes(1);
  });

  it("recognizes a legacy policy-fingerprint suffix", async () => {
    mocks.results.push([], [{ id: "source-legacy" }]);

    await expect(
      findProviderResourceDuplicateSourceId(
        "workspace-1",
        "provider:connection:item:revision",
      ),
    ).resolves.toBe("source-legacy");
    expect(mocks.where).toHaveBeenCalledTimes(2);
  });
});
