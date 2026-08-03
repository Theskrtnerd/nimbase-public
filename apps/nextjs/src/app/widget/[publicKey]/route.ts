import { loadWidgetInterfaceContext } from "~/server/agent/interfaces/widget/access";
import {
  frameAncestorsValue,
  widgetPanelHtml,
} from "~/server/agent/interfaces/widget/panel-html";

export const runtime = "nodejs";

// The chat panel page, rendered inside the customer-site iframe. Public by
// design. Widgets can be embedded anywhere by default; a configured domain
// allowlist narrows frame-ancestors while retaining our own-origin preview.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  const { publicKey } = await params;
  const ctx = await loadWidgetInterfaceContext(publicKey);
  if (!ctx) {
    // The iframe is visible to a visitor even when an embed code is stale or
    // malformed. Render the same inert panel used for unavailable widgets so
    // they never see the framework's plain-text 404 response.
    return new Response(
      widgetPanelHtml({
        name: "Chat unavailable",
        greeting: "",
        accent: "#14707e",
        position: "right",
        publicKey,
        state: "unavailable",
      }),
      {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          // This fallback has no widget data, so it is safe to show in the
          // original host page while still remaining unusable as a chat.
          "content-security-policy": "frame-ancestors *",
        },
      },
    );
  }

  const { agent, connection, config, folderPath } = ctx;
  const unavailable =
    !agent.enabled || connection.status !== "active" || folderPath === null;
  const html = widgetPanelHtml({
    name: agent.name,
    greeting: config.greeting,
    accent: config.theme.accent ?? "#14707e",
    position: config.theme.position ?? "right",
    publicKey,
    state: unavailable ? "unavailable" : "active",
  });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `frame-ancestors ${frameAncestorsValue(config.allowedDomains)}`,
    },
  });
}
