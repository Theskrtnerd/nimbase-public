import "server-only";

import type { UIMessage } from "ai";
import { convertToModelMessages, isStepCount, streamText } from "ai";

import { requireAccess, resolveAgentScopes } from "@acme/api/access";
import { intersectScopes } from "@acme/api/access-core";
import { costFor } from "@acme/cloud";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Agent, AgentTurn, SpendLedger } from "@acme/db/schema";

import { getAuthSession } from "~/auth/server";
import { agentAnchorPath } from "~/server/agent/anchor";
import {
  AGENT_MAX_STEPS,
  AGENT_MAX_TOTAL_TOKENS,
  assembleKbTurn,
} from "~/server/agent/turn";
import { invalidIdTextResponse, isUuidParam } from "~/server/http/params";

export const maxDuration = 60;

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

// In-app test chat for an agent. Streams the same fenced KB turn the deployed
// agent runs, but scoped to `agentScopes ∩ caller scopes` so the test surface
// can never reveal more than the tester could read directly.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAuthSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!isUuidParam(id)) return invalidIdTextResponse();
  const [agent] = await db
    .select()
    .from(Agent)
    .where(eq(Agent.id, id))
    .limit(1);
  if (!agent) return new Response("Agent not found", { status: 404 });

  const access = await requireAccess(session.user.id, agent.workspaceId);

  // Entity-visibility gate: you can test an agent only if you can read its
  // anchor. A null path means the anchor folder is gone — deny rather than
  // fall back to root.
  const anchorPath = await agentAnchorPath(
    agent.workspaceId,
    agent.targetFolderId,
  );
  if (anchorPath === null || !access.canRead(anchorPath)) {
    return new Response("Forbidden", { status: 403 });
  }

  const scopes = intersectScopes(
    await resolveAgentScopes(agent.id, agent.workspaceId),
    access.scopes("viewer"),
  );

  const { messages } = (await req.json()) as { messages: UIMessage[] };
  const assembled = await assembleKbTurn({
    workspaceId: agent.workspaceId,
    scopes,
    instructions: agent.instructions,
  });
  const question = lastUserText(messages);
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: assembled.model,
    instructions: assembled.instructions,
    tools: assembled.tools,
    maxOutputTokens: assembled.maxOutputTokens,
    messages: modelMessages,
    stopWhen: [
      isStepCount(AGENT_MAX_STEPS),
      ({ steps }) =>
        steps.reduce((n, s) => n + (s.usage.totalTokens ?? 0), 0) >
        AGENT_MAX_TOTAL_TOKENS,
    ],
    onEnd: async ({ text, totalUsage }) => {
      const cents = costFor(assembled.modelId, {
        inputTokens: totalUsage.inputTokens ?? 0,
        outputTokens: totalUsage.outputTokens ?? 0,
      });
      await db.insert(AgentTurn).values({
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        question,
        answer: text,
        tokens: totalUsage.totalTokens ?? 0,
        costCents: cents,
      });
      await db.insert(SpendLedger).values({
        workspaceId: agent.workspaceId,
        kind: "agent",
        cents,
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
