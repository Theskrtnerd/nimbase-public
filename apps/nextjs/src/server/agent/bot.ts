import "server-only";

import { createSlackAdapter } from "@chat-adapter/slack";
import { createPostgresState } from "@chat-adapter/state-pg";
import { Chat } from "chat";

import type { ConnectionPlatform } from "@acme/db/schema";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { AgentConnection } from "@acme/db/schema";

import { env } from "~/env";
import { decryptConnectionSecret } from "../connection-secret";
import { parseSlackSecrets } from "./secrets";

// The one Chat SDK instance. Adapters are multi-tenant: no bot token lives in
// the environment — every outbound call resolves the calling workspace's
// credential from `AgentConnection` (AES-256-GCM sealed, see `secrets.ts`).
//
// Slack does this through `installationProvider`, which the SDK documents as
// bypassing its own state store for token lookups. A platform added later that
// has no equivalent hook should have the worker pass a decrypted installation
// straight to the adapter instead — the invariant to preserve is that no
// platform token is ever written into Chat SDK state.

// Look up an active connection's sealed credential by platform + routeKey
// (for Slack, the team_id).
async function connectionSecrets(
  platform: ConnectionPlatform,
  routeKey: string,
): Promise<string | null> {
  const [conn] = await db
    .select({ secretsEncrypted: AgentConnection.secretsEncrypted })
    .from(AgentConnection)
    .where(
      and(
        eq(AgentConnection.platform, platform),
        eq(AgentConnection.routeKey, routeKey),
        eq(AgentConnection.status, "active"),
      ),
    )
    .limit(1);
  if (!conn?.secretsEncrypted) return null;
  return decryptConnectionSecret(conn.secretsEncrypted);
}

function createBotRuntime() {
  const slackAdapter = createSlackAdapter({
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    signingSecret: env.SLACK_SIGNING_SECRET,
    installationProvider: {
      getInstallation: async (installationId) => {
        const secretsJson = await connectionSecrets("slack", installationId);
        if (!secretsJson) return null;
        const { botToken } = parseSlackSecrets(secretsJson);
        return { botToken };
      },
    },
  });

  const bot = new Chat({
    userName: "nimbase",
    // Keyed by `ConnectionPlatform`. Adding Teams or Discord means one more
    // adapter here plus its arm in `routeKeyFor` and `withConnection`.
    adapters: { slack: slackAdapter },
    // Chat SDK requires a state adapter for dedupe, locks, and thread state. It
    // reuses POSTGRES_URL and creates its own `chat_state_*` tables on first
    // connect — deliberately outside Drizzle, which owns only the app schema.
    state: createPostgresState(),
    // Turns are serialized per connection by QStash flow control, so the SDK
    // should hand every mention straight to the handler rather than queue it.
    concurrency: "concurrent",
  });

  return { bot, slackAdapter };
}

type BotRuntime = ReturnType<typeof createBotRuntime>;

let runtime: BotRuntime | null = null;

// Slack is an optional self-hosted integration. Constructing its adapter at
// module load makes `next build` validate secrets even when Slack is disabled,
// so initialize the runtime only when a webhook or worker actually needs it.
export function getBotRuntime(): BotRuntime {
  runtime ??= createBotRuntime();
  return runtime;
}
