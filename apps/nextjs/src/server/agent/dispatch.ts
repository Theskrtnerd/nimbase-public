import "server-only";

import type { AgentTurnJobData } from "@acme/cloud";
import { publishAgentTurn } from "@acme/cloud";

import { env } from "~/env";
import { processAgentTurn } from "./process-turn";

// Prod (QSTASH_TOKEN set): hand off to QStash, return immediately. Local dev
// (unset): run inline. Mirrors dispatchArtifactGenerate.
export async function dispatchAgentTurn(data: AgentTurnJobData): Promise<void> {
  if (env.QSTASH_TOKEN) {
    await publishAgentTurn(data);
    return;
  }
  try {
    await processAgentTurn(data);
  } catch (err) {
    console.error("[agent] inline turn failed", err);
  }
}
