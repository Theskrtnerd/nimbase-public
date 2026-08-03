import { NextResponse } from "next/server";

import { env } from "~/env";
import { isAllowedRedirect } from "~/lib/allowed-redirect";
import { signState } from "~/server/agent/adapters/oauth-state";
import { SLACK_SCOPES, slackConfigured } from "~/server/agent/adapters/slack";
import { authorizeDeploy } from "~/server/agent/oauth-flow";

export const runtime = "nodejs";

// Start Slack OAuth for an agent (requires manager on its anchor).
export async function GET(req: Request): Promise<Response> {
  if (!slackConfigured()) {
    return new Response("Slack is not configured", { status: 503 });
  }
  const agentId = new URL(req.url).searchParams.get("agentId");
  const rawRedirect = new URL(req.url).searchParams.get("redirect");
  const redirect =
    rawRedirect && isAllowedRedirect(rawRedirect) ? rawRedirect : undefined;
  if (rawRedirect && !redirect) {
    return new Response("Invalid redirect", { status: 400 });
  }
  const auth = await authorizeDeploy(agentId);
  if (!auth.ok) return auth.response;

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", env.SLACK_CLIENT_ID ?? "");
  url.searchParams.set("scope", SLACK_SCOPES);
  url.searchParams.set(
    "state",
    signState({ agentId: auth.agent.id, userId: auth.userId, redirect }),
  );
  url.searchParams.set(
    "redirect_uri",
    `${env.NIMBASE_WEB_URL}/api/agents/slack/callback`,
  );
  return NextResponse.redirect(url.toString());
}
