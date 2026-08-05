import type { EmbeddingModel, LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { aiEnv } from "../env";

export type ProviderKind = "gateway" | "openai-compatible";

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
}

// A resolved provider yields the two model kinds the app uses, given an id.
export interface ResolvedProvider {
  language: (id: string) => LanguageModel;
  embedding: (id: string) => EmbeddingModel;
}

// gateway: the model id is passed straight through to the AI SDK, which routes
// it via the Vercel AI Gateway using AI_GATEWAY_API_KEY (today's behavior).
// openai-compatible: build a provider pointed at a self-hosted base URL, keyed
// by NIMBASE_AI_API_KEY. This is the seam for a self-hosted OSS model.
export function getProvider(config: ProviderConfig): ResolvedProvider {
  if (config.kind === "openai-compatible") {
    const provider = createOpenAICompatible({
      name: "nimbase-self-hosted",
      baseURL: config.baseUrl,
      apiKey: aiEnv().NIMBASE_AI_API_KEY ?? "",
    });
    return {
      language: (id) => provider.chatModel(id),
      embedding: (id) => provider.embeddingModel(id),
    };
  }
  return {
    language: (id) => id,
    embedding: (id) => id,
  };
}
