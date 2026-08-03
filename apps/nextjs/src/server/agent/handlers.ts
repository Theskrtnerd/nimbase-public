import "server-only";

import { randomUUID } from "node:crypto";
import type { Message, Thread } from "chat";

import type { ConnectionPlatform } from "@acme/db/schema";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { AgentConnection } from "@acme/db/schema";

import { getBotRuntime } from "./bot";
import { dispatchAgentTurn } from "./dispatch";
import { routeKeyFor } from "./route-key";
import { TURN_STATUS } from "./status";

// Chat SDK dispatches inbound mentions and DMs here. The handler does no AI
// work: it resolves the tenant and enqueues, so the webhook acks well inside
// Slack's 3s budget. The answering half lives in `process-turn.ts`.
async function enqueueTurn(thread: Thread, message: Message): Promise<void> {
  const platform = thread.adapter.name as ConnectionPlatform;
  const routeKey = routeKeyFor(platform, message.raw);
  if (!routeKey) return;

  const [conn] = await db
    .select({ id: AgentConnection.id })
    .from(AgentConnection)
    .where(
      and(
        eq(AgentConnection.platform, platform),
        eq(AgentConnection.routeKey, routeKey),
        eq(AgentConnection.status, "active"),
      ),
    )
    .limit(1);
  if (!conn) return;

  // The indicator goes up here rather than in the worker: between this webhook
  // and `process-turn`'s first line sit a QStash hop and four queries, and the
  // user stares at nothing for all of it. One Slack call, well inside the 3s
  // ack budget. The worker re-asserts it, which is harmless.
  await thread.startTyping(TURN_STATUS.thinking).catch(() => undefined);

  await dispatchAgentTurn({
    jobId: message.id || randomUUID(),
    connectionId: conn.id,
    threadId: thread.id,
    userText: message.text,
    externalUserId: message.author.userId,
  });
}

let handlersRegistered = false;

export function getBotWithHandlers() {
  const { bot } = getBotRuntime();
  if (!handlersRegistered) {
    bot.onNewMention(enqueueTurn);
    bot.onDirectMessage(enqueueTurn);
    handlersRegistered = true;
  }
  return bot;
}
