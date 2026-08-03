import { env } from "~/env";
import { verifyState } from "~/server/agent/adapters/oauth-state";
import {
  exchangeSlackCode,
  slackConfigured,
} from "~/server/agent/adapters/slack";
import {
  authorizeDeploy,
  deployedRedirect,
  deploymentFailure,
  upsertConnection,
} from "~/server/agent/oauth-flow";

export const runtime = "nodejs";

// Finish Slack OAuth: re-authorize, exchange the code, upsert the connection.
export async function GET(req: Request): Promise<Response> {
  if (!slackConfigured()) {
    return new Response("Slack is not configured", { status: 503 });
  }
  const params = new URL(req.url).searchParams;
  const state = params.get("state");
  if (!state) return new Response("Missing state", { status: 400 });
  const parsed = verifyState(state);
  if (!parsed) return new Response("Invalid state", { status: 400 });
  const remoteError = params.get("error");
  if (remoteError) {
    return deploymentFailure(parsed.redirect, remoteError, 400);
  }
  const code = params.get("code");
  if (!code) {
    return deploymentFailure(parsed.redirect, "missing_code", 400);
  }

  const auth = await authorizeDeploy(parsed.agentId);
  if (!auth.ok) {
    return deploymentFailure(
      parsed.redirect,
      auth.response.status === 401 ? "unauthorized" : "access_denied",
      auth.response.status,
    );
  }
  if (auth.userId !== parsed.userId) {
    return deploymentFailure(parsed.redirect, "unauthorized", 401);
  }

  try {
    const { botToken, teamId, teamName } = await exchangeSlackCode(
      code,
      `${env.NIMBASE_WEB_URL}/api/agents/slack/callback`,
    );
    await upsertConnection({
      agent: auth.agent,
      userId: auth.userId,
      platform: "slack",
      routeKey: teamId,
      secretsJson: JSON.stringify({ botToken }),
      meta: { teamName },
    });
    return deployedRedirect(auth.agent, parsed.redirect);
  } catch (error) {
    console.error("[agents.slack.callback] deployment failed", error);
    return deploymentFailure(parsed.redirect, "deployment_failed", 502);
  }
}
