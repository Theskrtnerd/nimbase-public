import "server-only";

import { generateObject } from "ai";
import { z } from "zod/v4";

import { costFor, resolveModels } from "@acme/cloud";
import { db } from "@acme/db/client";
import { SpendLedger } from "@acme/db/schema";

const MAX_TITLE_CHARS = 80;
const MAX_PROMPT_CHARS = 2000;

// Deterministic fallback — the pre-AI behaviour (raw prompt prefix).
function fallbackTitle(prompt: string): string {
  return prompt.trim().slice(0, MAX_TITLE_CHARS);
}

/**
 * Name a artifact from its prompt with one small model call. Never throws: any
 * failure (model down, empty answer, over-budget) falls back to the prompt
 * prefix, so artifact creation is never blocked on titling.
 */
export async function generateArtifactTitle(
  prompt: string,
  workspaceId: string,
): Promise<string> {
  const trimmed = prompt.trim();
  if (!trimmed) return "Untitled artifact";

  try {
    const { chat } = await resolveModels(workspaceId);
    const { object, usage } = await generateObject({
      model: chat.model,
      schema: z.object({
        title: z.string().max(MAX_TITLE_CHARS),
      }),
      prompt: [
        "Name the interface described by the request below.",
        "Rules: 2-5 words, Title Case, no quotes, no trailing punctuation, no words like 'app', 'page' or 'artifact' unless essential. Describe what it shows, not that it was requested.",
        "",
        "Request:",
        trimmed.slice(0, MAX_PROMPT_CHARS),
      ].join("\n"),
    });

    const cents = costFor(chat.id, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    if (cents > 0) {
      await db.insert(SpendLedger).values({
        workspaceId,
        kind: "artifact",
        cents,
      });
    }

    const title = object.title.trim().slice(0, MAX_TITLE_CHARS);
    return title || fallbackTitle(trimmed);
  } catch {
    return fallbackTitle(trimmed);
  }
}
