import { createHash } from "node:crypto";

import type { ArtifactRuntimeAssetName } from "@acme/runtime/artifact-runtime";
import { ARTIFACT_RUNTIME_ASSETS } from "@acme/runtime/artifact-runtime";
import { readResponseBytes, safeFetch } from "@acme/runtime/safe-http";

const MAX_RUNTIME_ASSET_BYTES = 4 * 1024 * 1024;
const runtimeAssetCache = new Map<
  ArtifactRuntimeAssetName,
  Promise<Uint8Array>
>();

export class ArtifactRuntimeIntegrityError extends Error {
  constructor(name: ArtifactRuntimeAssetName) {
    super(`Artifact runtime asset failed integrity validation: ${name}`);
    this.name = "ArtifactRuntimeIntegrityError";
  }
}

export async function fetchArtifactRuntimeAsset(
  name: ArtifactRuntimeAssetName,
): Promise<Uint8Array> {
  const cached = runtimeAssetCache.get(name);
  if (cached) return cached;

  const pending = fetchVerifiedArtifactRuntimeAsset(name);
  runtimeAssetCache.set(name, pending);
  try {
    return await pending;
  } catch (error) {
    if (runtimeAssetCache.get(name) === pending) runtimeAssetCache.delete(name);
    throw error;
  }
}

async function fetchVerifiedArtifactRuntimeAsset(
  name: ArtifactRuntimeAssetName,
): Promise<Uint8Array> {
  const asset = ARTIFACT_RUNTIME_ASSETS[name];
  const response = await safeFetch(asset.source, {
    headers: { accept: "application/javascript" },
    timeoutMs: 10_000,
  });
  if (!response.ok) {
    throw new Error(
      `Artifact runtime source returned HTTP ${response.status}: ${name}`,
    );
  }

  const bytes = await readResponseBytes(response, MAX_RUNTIME_ASSET_BYTES);
  const actual = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
  if (actual !== asset.integrity) {
    throw new ArtifactRuntimeIntegrityError(name);
  }
  return bytes;
}

export function resetArtifactRuntimeCacheForTesting(): void {
  runtimeAssetCache.clear();
}
