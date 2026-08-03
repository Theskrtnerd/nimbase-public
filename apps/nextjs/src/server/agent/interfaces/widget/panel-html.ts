import "server-only";

import { WIDGET_DEFAULT_ACCENT } from "@acme/db/schema";

// The chat panel served inside the customer-page iframe. Deliberately
// dependency-free HTML+JS (like the /s/[slug] share shell): no React, no
// Clerk, tiny payload, and nothing from the dashboard bundle can leak into a
// public surface. All dynamic strings are HTML-escaped; the visitor's and the
// model's text only ever reach the DOM through textContent.

// JSON for inline <script> embedding: escape < so user text can never break
// out of the script element (e.g. a "</script>" inside the greeting).
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const HOST_RE =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

// CSP frame-ancestors source list from the admin's optional allowed-domains
// input. An empty list permits any embedding origin. Explicit entries accept
// bare hosts, pasted origins/URLs, and *.wildcards; https only.
export function frameAncestorsValue(allowedDomains: string[]): string {
  if (allowedDomains.length === 0) return "*";

  const sources = allowedDomains.flatMap((raw) => {
    const d = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/:\d+$/, "");
    return HOST_RE.test(d) ? [`https://${d}`] : [];
  });
  return ["'self'", ...new Set(sources)].join(" ");
}

// Lucide (DESIGN.md §7: geometric line icons, 1.5–2px stroke, rounded caps —
// and explicitly no emoji). Static strings, so innerHTML is safe here.
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`;
const ICON_UNAVAILABLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`;

export interface PanelConfig {
  name: string;
  greeting: string;
  accent: string;
  position: "left" | "right";
  publicKey: string;
  state: "active" | "unavailable";
}

// First letter of the widget name, for the header monogram — mirrors the
// workspace switcher's monogram treatment in the dashboard.
function monogram(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(ch) ? ch : "N";
}

export function widgetPanelHtml(cfg: PanelConfig): string {
  const name = escapeHtml(cfg.name);
  const greeting = escapeHtml(cfg.greeting);
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(cfg.accent)
    ? cfg.accent
    : WIDGET_DEFAULT_ACCENT;
  const chatPath = `/api/widget/${encodeURIComponent(cfg.publicKey)}/chat`;
  const position = cfg.position === "left" ? "left" : "right";

  // Ocean palette + scale tokens from DESIGN.md §3–§5, inlined as vars because
  // this shell cannot import the app's theme.css. Plus Jakarta Sans is used if
  // the host page already has it and otherwise degrades through the documented
  // fallback stack — a public embed should never fetch a web font.
  const style = `
  :root {
    --accent: ${accent};
    --fg: #1B1D24;              /* --foreground, blue ink */
    --muted-fg: #5E7A95;        /* --brand-slate-500 */
    --surface: #FFFFFF;
    --surface-soft: #F1F6FC;    /* --brand-blue-50 */
    --bubble-bot: #FFFFFF;
    --border: #DCEAF8;          /* --brand-blue-100 */
    --ring: #3F73A8;            /* --brand-blue-500 */
    --radius: 10px;
    --ease: cubic-bezier(0.2, 0, 0, 1);
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    font: 400 14px/22px "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
    color: var(--fg); background: var(--surface);
    display: flex; flex-direction: column;
    -webkit-font-smoothing: antialiased;
  }

  /* The welcome surface carries the company's accent, while the conversation
     stays deliberately calm and highly readable. */
  header {
    position: relative; overflow: hidden; flex-shrink: 0;
    padding: 16px 18px 20px; color: #fff; background: var(--accent);
    isolation: isolate;
  }
  header::before {
    content: ""; position: absolute; z-index: -1; width: 180px; height: 180px;
    top: -112px; right: -44px; border-radius: 50%;
    background: color-mix(in srgb, white 20%, transparent);
  }
  header::after {
    content: ""; position: absolute; z-index: -1; width: 150px; height: 150px;
    bottom: -116px; left: -38px; border-radius: 50%;
    border: 1px solid color-mix(in srgb, white 28%, transparent);
  }
  .brand-row {
    display: flex; align-items: center; gap: 10px;
  }
  .avatar {
    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
    background: color-mix(in srgb, white 18%, transparent); color: #fff;
    border: 1px solid color-mix(in srgb, white 28%, transparent);
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 600; line-height: 1;
  }
  .titles { min-width: 0; }
  .name {
    font-size: 14px; line-height: 20px; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .status {
    display: flex; align-items: center; gap: 5px;
    font-size: 12px; line-height: 16px; color: color-mix(in srgb, white 78%, transparent);
  }
  .dot {
    width: 6px; height: 6px; border-radius: 50%; background: #fff;
    animation: pulse 2.4s var(--ease) infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
  .welcome {
    margin: 22px 0 0; max-width: 270px; font-size: 22px; line-height: 28px;
    font-weight: 650; letter-spacing: -.025em; text-wrap: balance;
  }
  .welcome-copy {
    margin-top: 7px; max-width: 300px; color: color-mix(in srgb, white 80%, transparent);
    font-size: 13px; line-height: 19px;
  }

  #log {
    flex: 1; overflow-y: auto; padding: 18px 14px; background: var(--surface-soft);
    display: flex; flex-direction: column; gap: 10px;
    scrollbar-width: thin; scrollbar-color: #C7D8EA transparent;
  }
  .msg {
    max-width: 86%; padding: 9px 13px; border-radius: 14px;
    white-space: pre-wrap; overflow-wrap: break-word;
    animation: message-in .32s var(--ease) both;
  }
  @keyframes message-in { from { opacity: 0; transform: translateY(7px) } to { opacity: 1; transform: translateY(0) } }
  .bot {
    background: var(--bubble-bot); color: var(--fg); align-self: flex-start;
    border: 1px solid var(--border); border-bottom-left-radius: 4px;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .user {
    background: var(--accent); color: #fff; align-self: flex-end;
    border-bottom-right-radius: 4px;
  }
  .system {
    align-self: center; text-align: center; max-width: 92%;
    font-size: 12px; line-height: 18px; color: var(--muted-fg);
    background: transparent; padding: 4px 10px;
  }

  /* Typing indicator — a quiet three-dot pulse, never a spinning orb (§5). */
  .typing { display: flex; gap: 4px; align-items: center; padding: 4px 2px; }
  .typing i {
    width: 6px; height: 6px; border-radius: 50%; background: var(--muted-fg);
    animation: bounce 1.2s var(--ease) infinite;
  }
  .typing i:nth-child(2) { animation-delay: .15s }
  .typing i:nth-child(3) { animation-delay: .3s }
  @keyframes bounce {
    0%, 60%, 100% { opacity: .3; transform: translateY(0) }
    30% { opacity: 1; transform: translateY(-3px) }
  }

  form {
    display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
    padding: 12px 14px; background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .powered-by {
    flex-shrink: 0; padding: 6px 14px 8px; background: var(--surface);
    border-top: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
    color: color-mix(in srgb, var(--muted-fg) 72%, transparent);
    font-size: 10px; line-height: 14px; letter-spacing: .01em; text-align: center;
  }
  .powered-by a {
    color: inherit; text-decoration: none;
    transition: color .15s var(--ease);
  }
  .powered-by a:hover { color: var(--accent); }
  .powered-by a:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 2px; }
  textarea {
    flex: 1; resize: none; font: inherit; color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 9px 12px; min-height: 38px; max-height: 120px; outline: none;
    transition: border-color .15s var(--ease), box-shadow .15s var(--ease);
  }
  textarea::placeholder { color: var(--muted-fg); }
  textarea:focus {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 18%, transparent);
  }
  #send {
    flex-shrink: 0; width: 38px; height: 38px; border: none; border-radius: 50%;
    background: var(--accent); color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 5px 12px color-mix(in srgb, var(--accent) 28%, transparent);
    transition: transform .15s var(--ease), opacity .15s var(--ease), box-shadow .2s var(--ease);
  }
  #send svg { width: 18px; height: 18px; }
  #send:not(:disabled):hover { transform: translateY(-1px) scale(1.03); box-shadow: 0 8px 16px color-mix(in srgb, var(--accent) 34%, transparent); }
  #send:active { transform: scale(.98); }
  #send:disabled { opacity: .45; cursor: default; transform: none; }

  .empty {
    margin: auto; padding: 32px 24px; text-align: center; color: var(--muted-fg);
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .empty svg { width: 28px; height: 28px; color: var(--ring); opacity: .6; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }`;

  const header = `
  <header>
    <div class="brand-row">
      <div class="avatar" aria-hidden="true">${escapeHtml(monogram(cfg.name))}</div>
      <div class="titles">
        <div class="name">${name}</div>
        ${cfg.state === "active" ? `<div class="status"><span class="dot"></span>Online now</div>` : ""}
      </div>
    </div>
    ${cfg.state === "active" ? `<p class="welcome">How can we help?</p>${greeting ? `<p class="welcome-copy">${greeting}</p>` : ""}` : ""}
  </header>`;

  const unavailableBody = `${header}
  <div id="log">
    <p class="empty">${ICON_UNAVAILABLE}<span>This chat isn't available right now. Please try again shortly.</span></p>
  </div>
  <footer class="powered-by"><a href="https://nimbase.ai" target="_blank" rel="noreferrer">Powered by Nimbase</a></footer>`;

  const activeBody = `${header}
  <div id="log" aria-live="polite"></div>
  <form id="composer">
    <textarea id="input" rows="1" placeholder="Ask a question…" aria-label="Message" required></textarea>
    <button id="send" type="submit" aria-label="Send">${ICON_SEND}</button>
  </form>
  <footer class="powered-by"><a href="https://nimbase.ai" target="_blank" rel="noreferrer">Powered by Nimbase</a></footer>
  <script>
  (function () {
    "use strict";
    var CHAT_PATH = ${jsonForScript(chatPath)};
    var CONFIG = { type: "nimbase-widget-config", accent: ${jsonForScript(accent)}, position: ${jsonForScript(position)} };
    try { parent.postMessage(CONFIG, "*"); } catch (e) { /* sandboxed */ }

    var log = document.getElementById("log");
    var form = document.getElementById("composer");
    var input = document.getElementById("input");
    var send = document.getElementById("send");
    var KEY = "nb_widget_session";
    var sessionId = "";
    try {
      sessionId = localStorage.getItem(KEY) || "";
      if (!sessionId) {
        sessionId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
          .map(function (b) { return b.toString(16).padStart(2, "0"); })
          .join("");
        localStorage.setItem(KEY, sessionId);
      }
    } catch (e) {
      sessionId = String(Math.random()).slice(2, 18);
    }

    var history = [];
    function bubble(cls) {
      var el = document.createElement("div");
      el.className = "msg " + cls;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }

    // Built from elements rather than innerHTML so the same node can be handed
    // straight to textContent once the first token lands.
    function showTyping(el) {
      var wrap = document.createElement("span");
      wrap.className = "typing";
      for (var i = 0; i < 3; i++) wrap.appendChild(document.createElement("i"));
      el.appendChild(wrap);
    }

    function autoGrow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    }
    input.addEventListener("input", autoGrow);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = input.value.trim();
      if (!text || send.disabled) return;
      input.value = "";
      autoGrow();
      bubble("user").textContent = text;
      history.push({ role: "user", content: text });
      send.disabled = true;
      var out = bubble("bot");
      showTyping(out);

      fetch(CHAT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId, messages: history }),
      })
        .then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () { return {}; }).then(function (d) {
              out.className = "msg system";
              out.textContent = d.error || "Something went wrong — try again.";
            });
          }
          out.textContent = "";
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var full = "";
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                history.push({ role: "assistant", content: full });
                return;
              }
              full += decoder.decode(r.value, { stream: true });
              out.textContent = full;
              log.scrollTop = log.scrollHeight;
              return pump();
            });
          }
          return pump();
        })
        .catch(function () {
          out.className = "msg system";
          out.textContent = "Connection lost — try again.";
        })
        .finally(function () {
          send.disabled = false;
          input.focus();
        });
    });

    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        form.requestSubmit();
      }
    });
  })();
  </script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${name}</title>
<style>${style}</style>
</head>
<body>${cfg.state === "active" ? activeBody : unavailableBody}</body>
</html>`;
}
