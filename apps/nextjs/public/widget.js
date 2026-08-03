// Nimbase website widget loader. Usage:
//   <script src="https://app.nimbase.ai/widget.js" data-widget-key="nb_wgt_..." async></script>
// Injects a floating launcher + a chat-panel iframe served by the app. The
// panel is the source of truth for theme (it posts a config message back);
// data-position is an optional override until that message arrives.
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute("data-widget-key");
  if (!key) return;
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (e) {
    return;
  }
  var position =
    script.getAttribute("data-position") === "left" ? "left" : "right";
  // DESIGN.md §3 --brand-blue-600, the ocean blue. Overridden by the panel's
  // config message once the iframe reports the widget's configured accent.
  var accent = "#0C5AA0";
  var open = false;
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Lucide message-circle / x (DESIGN.md §7: geometric line icons, no emoji).
  // Static strings, so innerHTML carries nothing from the host page.
  var SVG_OPEN =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var SVG_CLOSE =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  var launcher = document.createElement("button");
  launcher.setAttribute("aria-label", "Open chat");
  launcher.setAttribute("aria-expanded", "false");
  launcher.type = "button";
  var frame = document.createElement("iframe");
  frame.src = origin + "/widget/" + encodeURIComponent(key);
  frame.title = "Chat";

  function styleAll() {
    var side = position + ":20px;";
    // Shadows are tinted with the accent hue (DESIGN.md §5); the plain rgba
    // line is the fallback where color-mix() is unsupported.
    var lift =
      "box-shadow:0 4px 16px rgba(0,0,0,.18);" +
      "box-shadow:0 6px 20px color-mix(in srgb, " +
      accent +
      " 32%, transparent);";
    launcher.style.cssText =
      "position:fixed;bottom:20px;" +
      side +
      "z-index:2147483000;width:56px;height:56px;border-radius:50%;border:none;" +
      "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "padding:0;" +
      lift +
      "background:" +
      accent +
      ";color:#fff;" +
      (reduceMotion
        ? ""
        : "transition:transform .2s cubic-bezier(.22,1,.36,1),box-shadow .2s cubic-bezier(.22,1,.36,1);");
    launcher.innerHTML = open ? SVG_CLOSE : SVG_OPEN;
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    frame.style.cssText =
      "position:fixed;bottom:88px;" +
      side +
      "z-index:2147483000;width:384px;height:580px;max-width:calc(100vw - 40px);" +
      "max-height:calc(100vh - 110px);border:none;border-radius:16px;" +
      "box-shadow:0 12px 48px rgba(16,42,69,.22);background:#fff;color-scheme:light;" +
      "transform-origin:bottom " +
      position +
      ";" +
      "pointer-events:" +
      (open ? "auto" : "none") +
      ";" +
      "opacity:" +
      (open ? "1" : "0") +
      ";" +
      "transform:" +
      (open ? "translateY(0) scale(1)" : "translateY(12px) scale(.96)") +
      ";" +
      "visibility:" +
      (open ? "visible" : "hidden") +
      ";" +
      (reduceMotion
        ? ""
        : "transition:opacity .32s cubic-bezier(.22,1,.36,1),transform .32s cubic-bezier(.22,1,.36,1),visibility 0s linear " +
          (open ? "0s" : ".32s") +
          ";");
  }

  launcher.addEventListener("click", function () {
    open = !open;
    styleAll();
    if (!reduceMotion && open) {
      launcher.style.transform = "scale(.96)";
      window.requestAnimationFrame(function () {
        launcher.style.transform = "scale(1)";
      });
    }
  });
  if (!reduceMotion) {
    launcher.addEventListener("mouseenter", function () {
      launcher.style.transform = "scale(1.05)";
    });
    launcher.addEventListener("mouseleave", function () {
      launcher.style.transform = "scale(1)";
    });
    // Press feedback at the documented 0.98 (DESIGN.md §5).
    launcher.addEventListener("mousedown", function () {
      launcher.style.transform = "scale(.98)";
    });
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== origin) return;
    var d = e.data;
    if (!d || d.type !== "nimbase-widget-config") return;
    if (typeof d.accent === "string" && /^#[0-9a-fA-F]{3,8}$/.test(d.accent)) {
      accent = d.accent;
    }
    if (d.position === "left" || d.position === "right") position = d.position;
    styleAll();
  });

  function mount() {
    styleAll();
    document.body.appendChild(frame);
    document.body.appendChild(launcher);
  }
  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
