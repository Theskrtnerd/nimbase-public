/**
 * Mermaid support for artifact artifacts.
 *
 * Both artifact modes render diagrams the same way — an element with
 * `class="mermaid"` whose text is the diagram source — so the model never
 * touches mermaid's async render API and the two modes cannot drift.
 *
 * Loaded from unpkg, which the share CSP (`serve-share-html.ts`) and the
 * renderer's SSRF allowlist (`apps/artifact-renderer/src/render.ts`) already
 * permit, so diagrams need no widening of either boundary. The UMD bundle is
 * self-contained — no `eval`, no `new Function`, no dynamic `import()` — so it
 * runs under our `script-src` without `unsafe-eval`.
 */

// The full UMD bundle: ~3.4MB unminified-equivalent, every diagram type
// included. That weight is why callers inject this conditionally
// (`usesMermaid`) instead of putting it in every artifact shell.
const MERMAID_CDN = "https://unpkg.com/mermaid@11/dist/mermaid.min.js";

/**
 * Does this artifact actually reference a mermaid diagram?
 *
 * Matches the `mermaid` class in either dialect — `class="mermaid"` (freeform
 * HTML) or `className="mermaid"` (React TSX) — rather than the bare word, so
 * prose that merely mentions mermaid doesn't pull in a multi-megabyte script.
 */
export function usesMermaid(source: string): boolean {
  return /class(?:Name)?\s*=\s*["'`][^"'`]*\bmermaid\b/.test(source);
}

/**
 * Script tags that load mermaid and render every `.mermaid` element on the
 * page. Belongs in `<head>`.
 *
 * The observer is the load-bearing part: mermaid's own `startOnLoad` runs once
 * at document load, but a fixed artifact mounts its React tree *after* that, so
 * one-shot rendering would miss every diagram. Watching the document instead
 * covers both modes and any diagram a component renders later (tab switches,
 * conditional views).
 *
 * `securityLevel: "strict"` escapes HTML in diagram labels and disables click
 * handlers. The diagram text is model-generated and the page is already
 * sandboxed, but there is no reason for a diagram label to be an injection
 * point when nothing needs that capability.
 */
export const ARTIFACT_MERMAID_HEAD = `<script crossorigin src="${MERMAID_CDN}"></script>
<script>
(function () {
  var mermaid = window.mermaid;
  if (!mermaid) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    fontFamily: 'inherit'
  });
  // mermaid.run stamps data-processed on what it renders, so re-scanning is
  // cheap and already-drawn diagrams are never redrawn.
  function render() {
    var nodes = document.querySelectorAll(".mermaid:not([data-processed])");
    if (nodes.length) mermaid.run({ nodes: nodes }).catch(function () {});
  }
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; render(); });
  }
  // Coalesced through rAF so mermaid writing its own SVG back into the DOM
  // costs one no-op pass rather than a feedback loop.
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule);
  } else {
    schedule();
  }
})();
</script>`;
