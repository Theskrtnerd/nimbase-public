import { beforeEach, describe, expect, it, vi } from "vitest";

import { ARTIFACT_RUNTIME_ASSETS } from "@acme/runtime/artifact-runtime";
import { readResponseBytes, safeFetch } from "@acme/runtime/safe-http";

import {
  ArtifactRuntimeIntegrityError,
  fetchArtifactRuntimeAsset,
  resetArtifactRuntimeCacheForTesting,
} from "./runtime-assets";

vi.mock("@acme/runtime/safe-http", () => ({
  readResponseBytes: vi.fn(),
  safeFetch: vi.fn(),
}));

describe("fetchArtifactRuntimeAsset", () => {
  beforeEach(() => {
    resetArtifactRuntimeCacheForTesting();
    vi.clearAllMocks();
  });

  it("accepts only bytes matching the pinned digest", async () => {
    const bytes = new TextEncoder().encode("console.log('react')");
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Awaited<ReturnType<typeof safeFetch>>);
    vi.mocked(readResponseBytes).mockResolvedValue(bytes);
    const original = ARTIFACT_RUNTIME_ASSETS.react.integrity;
    try {
      Object.defineProperty(ARTIFACT_RUNTIME_ASSETS.react, "integrity", {
        configurable: true,
        value:
          "sha384-DvzHyVOxfX9jVbvquzSJMa6/YbXWs1a21PDSf6k6p8LRAV8SK1r/uT8zQkTHJzg6",
      });
      await expect(fetchArtifactRuntimeAsset("react")).resolves.toEqual(bytes);
    } finally {
      Object.defineProperty(ARTIFACT_RUNTIME_ASSETS.react, "integrity", {
        configurable: true,
        value: original,
      });
    }
  });

  it("rejects a bundle whose bytes do not match the manifest", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Awaited<ReturnType<typeof safeFetch>>);
    vi.mocked(readResponseBytes).mockResolvedValue(
      new TextEncoder().encode("tampered"),
    );

    await expect(fetchArtifactRuntimeAsset("react")).rejects.toBeInstanceOf(
      ArtifactRuntimeIntegrityError,
    );
  });

  it("caches a verified fixed asset in-process", async () => {
    const bytes = new TextEncoder().encode("console.log('react')");
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Awaited<ReturnType<typeof safeFetch>>);
    vi.mocked(readResponseBytes).mockResolvedValue(bytes);
    const original = ARTIFACT_RUNTIME_ASSETS.react.integrity;
    try {
      Object.defineProperty(ARTIFACT_RUNTIME_ASSETS.react, "integrity", {
        configurable: true,
        value:
          "sha384-DvzHyVOxfX9jVbvquzSJMa6/YbXWs1a21PDSf6k6p8LRAV8SK1r/uT8zQkTHJzg6",
      });
      await fetchArtifactRuntimeAsset("react");
      await fetchArtifactRuntimeAsset("react");
      expect(safeFetch).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(ARTIFACT_RUNTIME_ASSETS.react, "integrity", {
        configurable: true,
        value: original,
      });
    }
  });
});
