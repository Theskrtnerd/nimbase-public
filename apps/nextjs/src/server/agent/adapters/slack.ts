import "server-only";

import { env } from "~/env";

// Slack OAuth for agent deployment. Only the code exchange lives here — webhook
// verification, parsing, and posting are Chat SDK's job (`bot.ts`).
//
// The install/callback flow stays hand-written because it carries Nimbase
// authorization the SDK can't express: `authorizeDeploy` (manager on the
// agent's anchor) plus HMAC state binding the install to one agent + user. The
// SDK's `handleOAuthCallback` would skip both and write the token to its own
// state store instead of the sealed `AgentConnection` row.

// Channel/group/IM/MPIM read scopes cover thread context and let the source
// connector enumerate conversations the bot can access. users:read.email lets
// provider membership resolve to company UserProfiles before a stable Slack
// subject has been bound. assistant:write powers the native thinking indicator.
//
// files:write uploads rendered artifactes (PNG/PDF/HTML). Note that a scope
// cannot be added to an already-minted token: connections installed before
// this scope existed keep working, but their uploads fail with `missing_scope`
// until the workspace reconnects. `postAttachments` degrades to the link.
export const SLACK_SCOPES =
  "app_mentions:read,chat:write,files:write,im:history,im:read,mpim:history,mpim:read,channels:history,channels:read,channels:join,groups:history,groups:read,users:read,users:read.email,assistant:write";

export function slackConfigured(): boolean {
  return Boolean(
    env.SLACK_CLIENT_ID &&
      env.SLACK_CLIENT_SECRET &&
      env.SLACK_SIGNING_SECRET &&
      env.AGENT_CONNECTION_SECRET,
  );
}

export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
): Promise<{
  botToken: string;
  botUserId: string | null;
  teamId: string;
  teamName: string;
}> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID ?? "",
      client_secret: env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Slack OAuth request failed with status ${res.status}`);
  }
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id: string; name: string };
  };
  if (!data.ok || !data.access_token || !data.team) {
    throw new Error(`slack oauth failed: ${data.error ?? "unknown"}`);
  }
  return {
    botToken: data.access_token,
    botUserId: data.bot_user_id ?? null,
    teamId: data.team.id,
    teamName: data.team.name,
  };
}
