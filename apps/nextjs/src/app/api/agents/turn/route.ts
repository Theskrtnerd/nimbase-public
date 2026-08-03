import { agentTurnJobSchema } from "@acme/cloud/queue";

import { processAgentTurn } from "~/server/agent/process-turn";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";
// Must stay above CHAT_HARNESS_ARTIFACT_TIMEOUT_MS (process-turn.ts): a
// artifact-enabled turn absorbs a blocking generation poll, and the harness's own
// ceiling can only fire if the platform hasn't killed the function first. When
// it doesn't, the turn dies uncaught, QStash retries it, and the channel gets
// the whole answer over again.
export const maxDuration = 300;

// The publisher's schema, not a local mirror — a mirror that drops a field
// strips it silently on parse.
const Body = agentTurnJobSchema;

// Bodies are always published by publishAgentTurn; a parse/throw 500s so QStash
// retries.
async function handler(request: Request): Promise<Response> {
  const data = Body.parse(await request.json());
  await processAgentTurn(data);
  return Response.json({ ok: true });
}

export const POST = verifyQstashSignature(handler);
