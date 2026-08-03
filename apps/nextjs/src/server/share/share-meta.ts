/**
 * OpenGraph metadata for artifact share pages.
 *
 * Slack (and Linear, iMessage, Twitter, …) never render a linked page's HTML —
 * they read its `<head>` and build an unfurl card. The stored artifact artifact
 * from `buildArtifactHtml` carries only `charset` + `viewport`, so a shared
 * `/s/<slug>` link unfurls as a naked URL. These tags are spliced in at serve
 * time rather than baked into the artifact so existing artifactes get cards
 * without regeneration, and so a retitled artifact never serves a stale card.
 *
 * Deliberately no `og:image`: a real thumbnail would need a JS-executing
 * headless browser (the artifact loads React/Tailwind/recharts from CDNs at
 * runtime), which is infrastructure this repo does not have.
 */

/** Longest `og:description`; Slack truncates around here anyway. */
const DESCRIPTION_LIMIT = 200;

export interface ShareMeta {
  title: string;
  /** Free text — the artifact prompt. Collapsed and truncated for display. */
  description?: string | null;
  /** Absolute canonical URL of the share page. */
  url: string;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function summarize(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= DESCRIPTION_LIMIT) return collapsed;
  return `${collapsed.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

/** Render the `<title>` + OpenGraph/Twitter tags for a artifact share page. */
export function buildShareMeta(meta: ShareMeta): string {
  const title = meta.title.trim() || "Artifact";
  const description = meta.description ? summarize(meta.description) : "";

  const tags = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Nimbase" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:url" content="${escapeAttr(meta.url)}" />`,
    // summary (not summary_large_image): there is no image to show.
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
  ];
  if (description) {
    tags.push(
      `<meta name="description" content="${escapeAttr(description)}" />`,
      `<meta property="og:description" content="${escapeAttr(description)}" />`,
      `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    );
  }
  return tags.join("\n");
}

/**
 * Splice meta tags into a stored artifact's `<head>`.
 *
 * Inserted directly after the opening `<head>` so our `<title>` is the first
 * one in the document — a freeform artifact may have authored its own, and both
 * browsers and unfurlers take the first they see.
 */
export function injectShareMeta(html: string, meta: ShareMeta): string {
  const tags = buildShareMeta(meta);

  const at = openingHeadEnd(html);
  if (at !== -1) {
    return `${html.slice(0, at)}\n${tags}${html.slice(at)}`;
  }
  // No <head> at all (a bare fragment): prepend so crawlers still see the tags.
  return `${tags}\n${html}`;
}

function openingHeadEnd(html: string): number {
  const lowerHtml = html.toLowerCase();
  let start = lowerHtml.indexOf("<head");
  while (start !== -1) {
    const boundary = lowerHtml[start + 5];
    if (
      boundary === undefined ||
      boundary === ">" ||
      boundary === "/" ||
      boundary === " " ||
      boundary === "\t" ||
      boundary === "\r" ||
      boundary === "\n"
    ) {
      let quote: '"' | "'" | null = null;
      for (let index = start + 5; index < html.length; index++) {
        const char = html[index];
        if (quote) {
          if (char === quote) quote = null;
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === ">") {
          return index + 1;
        }
      }
      return -1;
    }
    start = lowerHtml.indexOf("<head", start + 1);
  }
  return -1;
}
