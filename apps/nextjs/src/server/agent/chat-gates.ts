import "server-only";

import type { UIMessage } from "ai";
import { safeValidateUIMessages } from "ai";

import { and, eq, gte, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { AgentTurn, SpendLedger } from "@acme/db/schema";

import { env } from "~/env";
import { readJsonRequest } from "../http/request-body";

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_MESSAGES = 24;
const MAX_TEXT_CHARS = 24_000;

export type AgentChatGate =
  | { ok: true }
  | { ok: false; status: 429; error: string };

export async function parseAgentChatMessages(
  request: Request,
): Promise<UIMessage[]> {
  const body = await readJsonRequest(request, MAX_REQUEST_BYTES);
  if (typeof body !== "object" || body === null || !("messages" in body)) {
    throw new Error("messages are required");
  }
  const validated = await safeValidateUIMessages<UIMessage>({
    messages: body.messages,
  });
  if (!validated.success) throw new Error("messages are invalid");
  if (validated.data.length === 0 || validated.data.length > MAX_MESSAGES) {
    throw new Error(`messages must contain 1-${MAX_MESSAGES} entries`);
  }
  const textChars = validated.data.reduce(
    (total, message) =>
      total +
      message.parts.reduce(
        (messageTotal, part) =>
          messageTotal + (part.type === "text" ? part.text.length : 0),
        0,
      ),
    0,
  );
  if (textChars > MAX_TEXT_CHARS) {
    throw new Error(`message text exceeds ${MAX_TEXT_CHARS} characters`);
  }
  return validated.data;
}

export function evaluateAgentChatGate(input: {
  requestsLastMinute: number;
  spentTodayCents: number;
  requestsPerMinute: number;
  dailyBudgetCents: number;
}): AgentChatGate {
  if (input.requestsLastMinute >= input.requestsPerMinute) {
    return {
      ok: false,
      status: 429,
      error: "workspace AI request rate exceeded",
    };
  }
  if (
    input.dailyBudgetCents > 0 &&
    input.spentTodayCents >= input.dailyBudgetCents
  ) {
    return {
      ok: false,
      status: 429,
      error: "workspace daily AI budget reached",
    };
  }
  return { ok: true };
}

export async function checkAgentChatGate(
  workspaceId: string,
): Promise<AgentChatGate> {
  const minuteAgo = new Date(Date.now() - 60_000);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [requests, spend] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(AgentTurn)
      .where(
        and(
          eq(AgentTurn.workspaceId, workspaceId),
          gte(AgentTurn.createdAt, minuteAgo),
        ),
      ),
    db
      .select({
        cents: sql<number>`coalesce(sum(${SpendLedger.cents}), 0)::int`,
      })
      .from(SpendLedger)
      .where(
        and(
          eq(SpendLedger.workspaceId, workspaceId),
          gte(SpendLedger.createdAt, dayStart),
        ),
      ),
  ]);
  return evaluateAgentChatGate({
    requestsLastMinute: requests[0]?.count ?? 0,
    spentTodayCents: spend[0]?.cents ?? 0,
    requestsPerMinute: env.NIMBASE_AI_REQUESTS_PER_MINUTE,
    dailyBudgetCents: env.NIMBASE_AI_DAILY_BUDGET_CENTS,
  });
}

export async function recordAgentTurnError(
  turnId: string,
  error: unknown,
): Promise<void> {
  try {
    await db
      .update(AgentTurn)
      .set({ error: error instanceof Error ? error.message : String(error) })
      .where(eq(AgentTurn.id, turnId));
  } catch (writeError) {
    console.error("[agent] failed to record turn error", writeError);
  }
}
