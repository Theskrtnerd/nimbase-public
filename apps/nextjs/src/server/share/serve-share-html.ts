import type { ArtifactRuntimeAssetName } from "@acme/runtime/artifact-runtime";
import {
  ARTIFACT_RUNTIME_ASSETS,
  ARTIFACT_RUNTIME_ORIGIN_PLACEHOLDER,
  artifactRuntimeUrl,
} from "@acme/runtime/artifact-runtime";

import type { ShareMeta } from "./share-meta";
import { injectShareMeta } from "./share-meta";

/**
 * The `sandbox` directive gives the document an opaque origin — the same
 * trust boundary as the in-app preview iframe (`sandbox="allow-scripts"`,
 * no `allow-same-origin`): no cookies, no localStorage, and same-origin
 * API calls become CORS-blocked requests from a `null` origin. The
 * popup flag keeps user-activated `target="_blank"` links working while the
 * popup inherits the sandbox. Every resource class starts closed and only the
 * fixed artifact runtime dependencies are opened explicitly.
 */
function shareCsp(runtimeOrigin: string): string {
  const runtimeScripts = (
    Object.keys(ARTIFACT_RUNTIME_ASSETS) as ArtifactRuntimeAssetName[]
  )
    .map((name) =>
      artifactRuntimeUrl(name).replace(
        ARTIFACT_RUNTIME_ORIGIN_PLACEHOLDER,
        runtimeOrigin,
      ),
    )
    .join(" ");
  return [
    "sandbox allow-scripts allow-popups",
    "default-src 'none'",
    `script-src 'unsafe-inline' ${runtimeScripts}`,
    "style-src 'unsafe-inline'",
    "font-src 'none'",
    "img-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export const ARTIFACT_ROBOTS_POLICY = "noindex, nofollow, noarchive";

/**
 * Serve stored artifact HTML (artifact or legacy share) on a public URL.
 *
 * `meta`, when given, splices OpenGraph tags into the artifact's `<head>` so
 * link unfurlers (Slack, Linear, iMessage) render a card instead of a bare
 * URL. It is applied here — on the authorized-serve path — and deliberately
 * not on 404 responses, so an anonymous crawler only ever reads the title of
 * an artifact it was already allowed to read in full.
 */
export function serveShareHtml(
  html: string,
  options: { runtimeOrigin: string; meta?: ShareMeta },
): Response {
  const runtimeOrigin = new URL(options.runtimeOrigin).origin;
  const hydrated = hydrateArtifactRuntime(html, runtimeOrigin);
  return new Response(
    options.meta ? injectShareMeta(hydrated, options.meta) : hydrated,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": shareCsp(runtimeOrigin),
        "referrer-policy": "no-referrer",
        "x-robots-tag": ARTIFACT_ROBOTS_POLICY,
      },
    },
  );
}

function hydrateArtifactRuntime(html: string, runtimeOrigin: string): string {
  let hydrated = html.replaceAll(
    ARTIFACT_RUNTIME_ORIGIN_PLACEHOLDER,
    runtimeOrigin,
  );

  // Keep artifacts generated before the local runtime migration working, but
  // only rewrite the exact historical URLs pinned in the manifest.
  for (const name of Object.keys(
    ARTIFACT_RUNTIME_ASSETS,
  ) as ArtifactRuntimeAssetName[]) {
    const asset = ARTIFACT_RUNTIME_ASSETS[name];
    hydrated = hydrated.replaceAll(
      asset.source,
      artifactRuntimeUrl(name).replace(
        ARTIFACT_RUNTIME_ORIGIN_PLACEHOLDER,
        runtimeOrigin,
      ),
    );
  }
  return hydrated.replaceAll(
    "https://cdn.tailwindcss.com",
    artifactRuntimeUrl("tailwind").replace(
      ARTIFACT_RUNTIME_ORIGIN_PLACEHOLDER,
      runtimeOrigin,
    ),
  );
}
