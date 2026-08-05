import { embed, embedMany } from "ai";

import { resolveModels } from "./ai/resolve";

// Embeddings through the central AI layer. The embed model is global-only
// (dimension-locked to wiki_chunk.embedding's 1536 dims), so resolution takes
// no workspaceId. Routed via the Vercel AI Gateway by default.

export interface EmbedResult {
  embeddings: number[][];
  tokens: number;
  modelId?: string;
}

// The embedding surface both the write path (chunk indexing) and the read path
// (query embedding) go through. Exposed as an interface so tests/evals can swap
// the live AI-gateway calls for FROZEN, committed embeddings — the retrieval
// eval runs offline and deterministically with no AI key. See
// `setEmbedderForTesting`.
export interface Embedder {
  embedChunks(texts: string[]): Promise<EmbedResult>;
  embedQuery(text: string): Promise<number[] | null>;
}

let override: Embedder | null = null;

// Test/eval-only seam: route `embedChunks`/`embedQuery` through an alternate
// embedder (the retrieval eval injects one backed by committed embeddings; its
// refresh script injects a capturing one). Production NEVER calls this, so the
// default stays the live AI-gateway path. Pass `null` to restore it.
export function setEmbedderForTesting(embedder: Embedder | null): void {
  override = embedder;
}

// Embed many chunk texts in one batched call (embedMany auto-splits if needed).
export async function embedChunks(texts: string[]): Promise<EmbedResult> {
  if (override) return override.embedChunks(texts);
  if (texts.length === 0) return { embeddings: [], tokens: 0 };
  const { embed: embedModel } = await resolveModels();
  const { embeddings, usage } = await embedMany({
    model: embedModel.model,
    values: texts,
  });
  return { embeddings, tokens: usage.tokens, modelId: embedModel.id };
}

// Embed a single search query. Returns null on failure so callers can fall
// back to keyword-only search.
export async function embedQuery(text: string): Promise<number[] | null> {
  if (override) return override.embedQuery(text);
  try {
    const { embed: embedModel } = await resolveModels();
    const { embedding } = await embed({ model: embedModel.model, value: text });
    return embedding;
  } catch (err) {
    console.error("[embed] query embedding failed", err);
    return null;
  }
}
