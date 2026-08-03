import type { PiHarnessSettings } from "@ai-sdk/harness-pi";

export interface HarnessModel {
  // Registry/gateway model id — what costFor() and telemetry expect.
  modelId: string;
  // Pi settings carrying the same selection in Pi's own model/auth shape.
  pi: PiHarnessSettings;
}

// The already-resolved selection this module renders into Pi settings. Reading
// it (the ai_config row, the workspace override, the API key from the
// environment) is the caller's job — see ./bindings.ts. Keeping the render
// pure is what lets this file move: a DB read here would tie the harness
// runtime back to @acme/cloud, which already depends on @acme/agents.
export interface HarnessModelSelection {
  modelId: string;
  providerKind: "gateway" | "openai-compatible";
  // Only read for the openai-compatible kind.
  baseUrl?: string;
  apiKey?: string;
}

// Express a model selection as Pi harness settings instead of an AI SDK
// LanguageModel: Pi takes a model *string*, routed via the ambient AI Gateway
// (gateway kind) or a custom OpenAI-compatible endpoint registered through
// customEnv (self-hosted kind — the NIMBASE_* prefix registers a "nimbase"
// provider, hence the prefixed model id).
export function harnessModelFor(
  selection: HarnessModelSelection,
): HarnessModel {
  const { modelId } = selection;
  if (selection.providerKind === "openai-compatible") {
    return {
      modelId,
      pi: {
        model: `nimbase/${modelId}`,
        auth: {
          customEnv: {
            NIMBASE_API_KEY: selection.apiKey ?? "",
            NIMBASE_BASE_URL: selection.baseUrl ?? "",
          },
        },
      },
    };
  }
  return { modelId, pi: { model: modelId } };
}
