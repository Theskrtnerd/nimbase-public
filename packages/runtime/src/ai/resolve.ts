import type { EmbeddingModel, LanguageModel } from "ai";

import { getGlobalConfig, getWorkspaceOverride } from "./config";
import { getProvider } from "./provider";

export interface ResolvedModel<M> {
  id: string;
  model: M;
}

export interface ResolvedModels {
  chat: ResolvedModel<LanguageModel>;
  normalize: ResolvedModel<LanguageModel>;
  embed: ResolvedModel<EmbeddingModel>;
}

// Resolution order: workspace override → global config row → code defaults.
// embed is global-only (the embedding column is dimension-locked), so it never
// takes a workspace override. Pass no workspaceId for global-only contexts
// (e.g. embeddings) to skip the per-workspace read.
export async function resolveModels(
  workspaceId?: string,
): Promise<ResolvedModels> {
  const global = await getGlobalConfig();
  const override = workspaceId
    ? await getWorkspaceOverride(workspaceId)
    : { chatModel: null, normalizeModel: null };

  const provider = getProvider({
    kind: global.providerKind,
    baseUrl: global.baseUrl,
  });

  const chatId = override.chatModel ?? global.chatModel;
  const normalizeId = override.normalizeModel ?? global.normalizeModel;
  const embedId = global.embedModel;

  return {
    chat: { id: chatId, model: provider.language(chatId) },
    normalize: { id: normalizeId, model: provider.language(normalizeId) },
    embed: { id: embedId, model: provider.embedding(embedId) },
  };
}
