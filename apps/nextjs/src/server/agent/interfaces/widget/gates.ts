import "server-only";

import { createHash } from "node:crypto";

import { and, eq, gte, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { AgentTurn } from "@acme/db/schema";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;
const SESSION_PER_MIN = 8;
const IP_PER_MIN = 20;
const WIDGET_PER_MIN = 60;

export function clampMessages(messages: ChatMsg[]): ChatMsg[] {
  return messages.slice(-MAX_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_MESSAGE_CHARS),
  }));
}

export function hashIp(req: Request): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

export interface GateInput {
  widgetsLimit: number; // plan limit; 0 = feature off (free)
  sessionCount: number; // turns this visitor session, last 60s
  ipCount: number; // turns from this ip, last 60s
  widgetCount: number; // turns on this widget, last 60s
  spentTodayCents: number;
  capCents: number;
}

export type GateResult =
  | { ok: true }
  | { ok: false; status: 402 | 429; message: string };

const BUSY = "You're sending messages quickly — try again in a moment.";
const UNAVAILABLE = "The assistant is unavailable right now.";

export function evaluateGates(input: GateInput): GateResult {
  if (input.widgetsLimit <= 0) {
    return { ok: false, status: 402, message: UNAVAILABLE };
  }
  if (input.sessionCount >= SESSION_PER_MIN) {
    return { ok: false, status: 429, message: BUSY };
  }
  if (input.ipCount >= IP_PER_MIN) {
    return { ok: false, status: 429, message: BUSY };
  }
  if (input.widgetCount >= WIDGET_PER_MIN) {
    return { ok: false, status: 429, message: BUSY };
  }
  if (input.spentTodayCents >= input.capCents) {
    return { ok: false, status: 429, message: UNAVAILABLE };
  }
  return { ok: true };
}

export interface GateCounts {
  sessionCount: number;
  ipCount: number;
  widgetCount: number;
  spentTodayCents: number;
}

// DB counts for the rate/spend gates — same count-the-log pattern as agent
// turns (process-turn.ts), no extra infrastructure.
export async function loadGateCounts(
  connectionId: string,
  visitorSessionId: string,
  ipHash: string,
): Promise<GateCounts> {
  const minuteAgo = new Date(Date.now() - 60_000);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const [session, ip, widget, spent] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(AgentTurn)
      .where(
        and(
          eq(AgentTurn.connectionId, connectionId),
          eq(AgentTurn.channelKey, visitorSessionId),
          gte(AgentTurn.createdAt, minuteAgo),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(AgentTurn)
      .where(
        and(eq(AgentTurn.ipHash, ipHash), gte(AgentTurn.createdAt, minuteAgo)),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(AgentTurn)
      .where(
        and(
          eq(AgentTurn.connectionId, connectionId),
          gte(AgentTurn.createdAt, minuteAgo),
        ),
      ),
    db
      .select({
        cents: sql<number>`coalesce(sum(${AgentTurn.costCents}), 0)::int`,
      })
      .from(AgentTurn)
      .where(
        and(
          eq(AgentTurn.connectionId, connectionId),
          gte(AgentTurn.createdAt, dayStart),
        ),
      ),
  ]);
  return {
    sessionCount: session[0]?.n ?? 0,
    ipCount: ip[0]?.n ?? 0,
    widgetCount: widget[0]?.n ?? 0,
    spentTodayCents: spent[0]?.cents ?? 0,
  };
}
