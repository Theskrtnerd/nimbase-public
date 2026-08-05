import type { LanguageModelUsage } from "ai";

import type { ModelEntry } from "./registry";
import { MODEL_REGISTRY } from "./registry";

// Cents for a usage record under a model's registry pricing. An unknown model
// costs 0 (logged) rather than throwing — spend tracking must never break a job.
export function costFor(
  modelId: string,
  usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">,
): number {
  const entry = (MODEL_REGISTRY as Record<string, ModelEntry>)[modelId];
  if (!entry) {
    console.error(`[ai/cost] no pricing for model ${modelId}`);
    return 0;
  }
  return Math.round(
    ((usage.inputTokens ?? 0) * entry.inputCentsPerMTok +
      (usage.outputTokens ?? 0) * entry.outputCentsPerMTok) /
      1_000_000,
  );
}
