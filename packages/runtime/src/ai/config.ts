import type { AiProviderKind } from "@acme/db/schema";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { AI_CONFIG_ID, AiConfig, WorkspaceAiConfig } from "@acme/db/schema";

import { aiEnv } from "../env";
import { DEFAULT_MODELS } from "./registry";

export interface GlobalAiConfig {
  providerKind: AiProviderKind;
  baseUrl: string;
  chatModel: string;
  normalizeModel: string;
  embedModel: string;
}

// Used when no ai_config row exists yet (fresh install) or a read fails — the
// system stays on the gateway defaults rather than going dark.
const GLOBAL_FALLBACK: GlobalAiConfig = {
  providerKind: "gateway",
  baseUrl: "https://ai-gateway.vercel.sh",
  chatModel: DEFAULT_MODELS.chat,
  normalizeModel: DEFAULT_MODELS.normalize,
  embedModel: DEFAULT_MODELS.embed,
};

function environmentConfig(): GlobalAiConfig | null {
  const env = aiEnv();
  if (!env.NIMBASE_AI_PROVIDER) return null;

  const { NIMBASE_AI_BASE_URL: baseUrl } = env;
  const { NIMBASE_AI_CHAT_MODEL: chatModel } = env;
  const { NIMBASE_AI_NORMALIZE_MODEL: normalizeModel } = env;
  const { NIMBASE_AI_EMBED_MODEL: embedModel } = env;
  if (!baseUrl || !chatModel || !normalizeModel || !embedModel) {
    throw new Error(
      "NIMBASE_AI_PROVIDER requires NIMBASE_AI_BASE_URL, NIMBASE_AI_CHAT_MODEL, NIMBASE_AI_NORMALIZE_MODEL, and NIMBASE_AI_EMBED_MODEL",
    );
  }

  return {
    providerKind: env.NIMBASE_AI_PROVIDER,
    baseUrl,
    chatModel,
    normalizeModel,
    embedModel,
  };
}

// 30s in-process cache so per-call resolution doesn't hit the DB every time;
// invalidated immediately on write via invalidateGlobalConfig().
let cache: { value: GlobalAiConfig; at: number } | null = null;
const TTL_MS = 30_000;

export function invalidateGlobalConfig(): void {
  cache = null;
}

export async function getGlobalConfig(): Promise<GlobalAiConfig> {
  const fromEnvironment = environmentConfig();
  if (fromEnvironment) return fromEnvironment;

  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const [row] = await db
      .select()
      .from(AiConfig)
      .where(eq(AiConfig.id, AI_CONFIG_ID))
      .limit(1);
    const value: GlobalAiConfig = row
      ? {
          providerKind: row.providerKind,
          baseUrl: row.baseUrl,
          chatModel: row.chatModel,
          normalizeModel: row.normalizeModel,
          embedModel: row.embedModel,
        }
      : GLOBAL_FALLBACK;
    cache = { value, at: now };
    return value;
  } catch (err) {
    console.error("[ai/config] global read failed; using fallback", err);
    return GLOBAL_FALLBACK;
  }
}

export interface WorkspaceOverride {
  chatModel: string | null;
  normalizeModel: string | null;
}

export async function getWorkspaceOverride(
  workspaceId: string,
): Promise<WorkspaceOverride> {
  try {
    const [row] = await db
      .select({
        chatModel: WorkspaceAiConfig.chatModel,
        normalizeModel: WorkspaceAiConfig.normalizeModel,
      })
      .from(WorkspaceAiConfig)
      .where(eq(WorkspaceAiConfig.workspaceId, workspaceId))
      .limit(1);
    return {
      chatModel: row?.chatModel ?? null,
      normalizeModel: row?.normalizeModel ?? null,
    };
  } catch (err) {
    console.error("[ai/config] workspace read failed; inheriting global", err);
    return { chatModel: null, normalizeModel: null };
  }
}
