import { after } from "next/server";

import { slackConfigured } from "~/server/agent/adapters/slack";
import { getBotWithHandlers } from "~/server/agent/handlers";

export const runtime = "nodejs";

// One inbound endpoint per chat platform. Chat SDK owns verification, parsing,
// dedupe, and dispatch to the handlers registered in `handlers.ts`; `waitUntil`
// keeps the detached handler alive past the ack.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> {
  const { platform } = await params;
  // Add a platform's arm here alongside its adapter in `bot.ts`; anything else
  // 404s rather than falling through to a handler that can't verify it.
  if (platform !== "slack") {
    return new Response("unknown platform", { status: 404 });
  }
  if (!slackConfigured()) {
    return new Response("Slack is not configured", { status: 503 });
  }
  const webhook = getBotWithHandlers().webhooks.slack;

  return webhook(req, {
    waitUntil: (task) => after(() => task),
  });
}
