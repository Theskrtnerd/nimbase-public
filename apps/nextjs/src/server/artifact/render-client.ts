import "server-only";

import { env } from "~/env";

/**
 * Client for the artifact render service (`apps/artifact-renderer`).
 *
 * Kept behind optional env so the app runs unchanged with no renderer
 * deployed: `rendererAvailable()` is false, `decideArtifactAttachment` refuses
 * png/pdf, and chat falls back to posting the link. Nothing hard-fails.
 */

/** Ceiling for one render. The service's own nav timeout is 20s. */
const RENDER_TIMEOUT_MS = 45_000;

export function rendererAvailable(): boolean {
  return Boolean(env.ARTIFACT_RENDERER_URL && env.ARTIFACT_RENDERER_TOKEN);
}

export class RenderError extends Error {}

export async function renderArtifactArtifact(
  html: string,
  format: "png" | "pdf",
): Promise<Buffer> {
  const base = env.ARTIFACT_RENDERER_URL;
  const token = env.ARTIFACT_RENDERER_TOKEN;
  if (!base || !token) {
    throw new RenderError("renderer not configured");
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/render`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ html, format }),
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new RenderError(
      `renderer unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new RenderError(
      `renderer returned ${res.status}: ${detail.slice(0, 200)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
