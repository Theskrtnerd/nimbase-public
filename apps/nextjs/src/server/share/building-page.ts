import "server-only";

/**
 * Placeholder served on `/s/<slug>` while a artifact is still generating.
 *
 * A artifact's slug is minted at creation, so the link is handed out before the
 * artifact exists — chat surfaces post it the moment they have it. Without this
 * the route 404s for that window, which is why authoring used to block on a
 * generation poll and burn the caller's whole turn budget waiting.
 *
 * Deliberately content-free: it names no title and no prompt, so it says
 * nothing a 404 wouldn't. The access gate around it is the same one a finished
 * artifact gets — only the body differs.
 *
 * Refreshes with `<meta http-equiv="refresh">` rather than script, so it needs
 * no CSP allowance of its own.
 */
export function buildingPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="refresh" content="5"/>
<title>Building…</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    background:radial-gradient(900px 600px at 80% -10%,#dce7fb,transparent 60%),#f3f6fc;color:#1b2740}
  main{background:#fff;border:1px solid #dbe3f1;border-radius:16px;padding:28px;width:min(360px,92vw);
    text-align:center;box-shadow:0 24px 60px -32px rgba(38,64,120,.35)}
  .dot{width:8px;height:8px;border-radius:50%;background:#3b6fe0;display:inline-block;margin:0 3px;
    animation:p 1.2s ease-in-out infinite}
  .dot:nth-child(2){animation-delay:.15s}
  .dot:nth-child(3){animation-delay:.3s}
  @keyframes p{0%,80%,100%{opacity:.25}40%{opacity:1}}
  @media (prefers-reduced-motion:reduce){.dot{animation:none;opacity:.6}}
  h1{font-size:16px;margin:14px 0 4px;letter-spacing:-.01em}
  p{font-size:13px;color:#5a678a;margin:0}
</style></head>
<body><main>
  <span class="dot"></span><span class="dot"></span><span class="dot"></span>
  <h1>This artifact is still being built</h1>
  <p>It usually takes about a minute. This page refreshes on its own.</p>
</main></body></html>`;
}
