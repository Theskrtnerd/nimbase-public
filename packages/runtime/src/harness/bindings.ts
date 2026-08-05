import type { PathScope } from "@acme/db";

import type { HarnessModel } from "./model";
import type { HarnessRunArgs, HarnessRunResult } from "./run";
import { getGlobalConfig, getWorkspaceOverride } from "../ai/config";
import { traceGeneration } from "../ai/telemetry";
import { cloudEnv } from "../env";
import { searchWorkspace } from "../search";
import { harnessModelFor } from "./model";
import { runHarnessAgent as runHarnessAgentCore } from "./run";
import { kbSearchTool as buildKbSearchTool } from "./tools";

// The single cloud-facing file in the harness runtime.
//
// Everything else under harness/ takes its capabilities as arguments, so this
// is the only module that reaches back into @acme/runtime — for embedding search
// (../search), the DB-backed model config (../ai/config) and the environment
// (../env). @acme/runtime already depends on @acme/agents, so those imports
// anywhere else in harness/ would make the runtime impossible to lift out
// without a package cycle (NOT-77). Concentrating them here means the move
// rewrites one file instead of five.

// A harness turn traced through Langfuse. Without this binding the core runs
// untraced (its default tracer is a passthrough), so every caller should reach
// for this one rather than ./run directly.
export function runHarnessAgent(
  args: Omit<HarnessRunArgs, "tracer">,
): Promise<HarnessRunResult> {
  return runHarnessAgentCore({ ...args, tracer: traceGeneration });
}

// searchWorkspace bound as the KbSearchFn the pure tool expects.
export function kbSearchTool(opts: {
  workspaceId: string;
  scopes: PathScope[] | undefined;
}) {
  return buildKbSearchTool({ ...opts, search: searchWorkspace });
}

// Same resolution order as resolveModels() (workspace override → global row →
// defaults); the rendering into Pi settings is harnessModelFor.
export async function resolveHarnessModel(
  workspaceId: string,
): Promise<HarnessModel> {
  const [global, override] = await Promise.all([
    getGlobalConfig(),
    getWorkspaceOverride(workspaceId),
  ]);
  return harnessModelFor({
    modelId: override.chatModel ?? global.chatModel,
    providerKind: global.providerKind,
    baseUrl: global.baseUrl,
    apiKey: cloudEnv().NIMBASE_AI_API_KEY ?? undefined,
  });
}
