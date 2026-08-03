import { createHash } from "node:crypto";

import type { Embedder, EmbedResult } from "../../embed";

// The committed embedding fixture: a text→vector table computed ONCE by
// refresh-embeddings.ts and read back at eval time so retrieval runs offline,
// deterministically, and with no AI key. Keyed by sha256 of the exact text the
// search/write path embeds (chunk texts + query texts), so the eval never embeds
// anything live.

export interface FrozenEmbeddings {
  // The embedder that produced this file: STUB_MODEL, or the real embed model id
  // when refreshed with --real. Surfaced in the eval report.
  model: string;
  dim: number;
  // Present when frozen with the stub embedder; a loud REGENERATE-ME marker.
  note?: string;
  // sha256(text) → embedding vector.
  byText: Record<string, number[]>;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// An embedder that answers ONLY from the frozen table. A miss is a hard error
// (not a silent live/zero fallback): it means the fixture drifted from what the
// code now embeds, and the fix is to re-run the refresh — never to embed live,
// which the real model can't do offline anyway.
export function frozenEmbedder(frozen: FrozenEmbeddings): Embedder {
  const lookup = (text: string): number[] => {
    const vec = frozen.byText[hashText(text)];
    if (!vec) {
      throw new Error(
        `[eval] no frozen embedding for a text the search/write path requested ` +
          `(len=${String(text.length)}). The fixture is stale — run \`pnpm eval:refresh\`.`,
      );
    }
    return vec;
  };
  return {
    embedChunks: (texts: string[]): Promise<EmbedResult> =>
      Promise.resolve({ embeddings: texts.map(lookup), tokens: 0 }),
    embedQuery: (text: string): Promise<number[] | null> =>
      Promise.resolve(lookup(text)),
  };
}

// A recording embedder used by the refresh script: it captures every text the
// real code embeds so the refresh embeds exactly the texts the eval will later
// request — no duplication of the chunking transform. Chunk embeds return a
// throwaway zero vector (the write path only needs SOME 1536-dim value to
// persist); query embeds return null so search skips the vector leg (a zero
// query vector has undefined cosine distance) — the query text is still recorded.
export function capturingEmbedder(sink: Set<string>, dim: number): Embedder {
  const zero = new Array<number>(dim).fill(0);
  return {
    embedChunks: (texts: string[]): Promise<EmbedResult> => {
      for (const t of texts) sink.add(t);
      return Promise.resolve({
        embeddings: texts.map(() => zero),
        tokens: 0,
      });
    },
    embedQuery: (text: string): Promise<number[] | null> => {
      sink.add(text);
      return Promise.resolve(null);
    },
  };
}
