import type { ShareMeta } from "./share-meta";
import { injectShareMeta } from "./share-meta";

/**
 * The `sandbox` directive gives the document an opaque origin — the same
 * trust boundary as the in-app preview iframe (`sandbox="allow-scripts"`,
 * no `allow-same-origin`): no cookies, no localStorage, and same-origin
 * API calls become CORS-blocked requests from a `null` origin. The
 * popup flags keep `target="_blank"` links working without inheriting
 * the sandbox. `script-src` pins scripts to the CDNs `buildArtifactHtml`
 * emits plus its inline bootstrap.
 */
const SHARE_CSP = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  "script-src 'unsafe-inline' https://unpkg.com https://cdn.tailwindcss.com",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

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
export function serveShareHtml(html: string, meta?: ShareMeta): Response {
  return new Response(meta ? injectShareMeta(html, meta) : html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SHARE_CSP,
      "referrer-policy": "no-referrer",
      "x-robots-tag": ARTIFACT_ROBOTS_POLICY,
    },
  });
}
