// Refresh the FROZEN embedding fixture (fixtures/embeddings.json). Run with tsx:
//
//   pnpm eval:refresh          # deterministic offline stub embedder (no AI key)
//   pnpm eval:refresh:real     # real embed model via Infisical + AI gateway
//
// The `:real` script wraps this in `infisical run --env dev` so the AI-gateway
// key is present; without it, resolveModels()/embed() have no credentials.
//
// How it stays in lockstep with the eval: this script drives the SAME
// setup+seed+query path the eval runs, but with a CAPTURING embedder that only
// records the texts the real code embeds (chunk texts from the write path, query
// texts from search). It then embeds exactly those texts and writes them keyed
// by sha256(text). The eval reads them back by the same key, so there is never a
// missing-embedding drift as long as fixtures + chunker are unchanged.
import { writeFileSync } from "node:fs";

import type { FrozenEmbeddings } from "./frozen-embeddings";
import { embedChunks, setEmbedderForTesting } from "../../embed";
import { FIXTURE_QUERIES } from "./fixtures/queries";
import { capturingEmbedder, hashText } from "./frozen-embeddings";
import { adminContext, readerExcept, setupEval } from "./harness";
import { EMBED_DIM, STUB_MODEL, stubEmbed } from "./stub-embedder";

const OUT = new URL("./fixtures/embeddings.json", import.meta.url);
const useReal = process.argv.includes("--real");

// 1. Capture every text the real seed + search path embeds.
async function captureTexts(): Promise<Set<string>> {
  const sink = new Set<string>();
  const env = await setupEval(capturingEmbedder(sink, EMBED_DIM));
  try {
    for (const q of FIXTURE_QUERIES) {
      const ctx =
        q.context === "no-board"
          ? readerExcept(env.workspaceId, ["restricted/board"])
          : adminContext(env.workspaceId);
      await env.provider.search(ctx, { text: q.text });
    }
  } finally {
    await env.teardown();
  }
  return sink;
}

// 2a. Real embeddings: batch through the live embed model (override cleared).
async function embedReal(texts: string[]): Promise<Map<string, number[]>> {
  setEmbedderForTesting(null);
  const out = new Map<string, number[]>();
  const BATCH = 96;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const { embeddings } = await embedChunks(batch);
    batch.forEach((t, j) => {
      const vec = embeddings[j];
      if (vec) out.set(t, vec);
    });
    console.log(
      `  embedded ${String(Math.min(i + BATCH, texts.length))}/${String(texts.length)}`,
    );
  }
  return out;
}

// 2b. Stub embeddings: pure, deterministic, offline.
function embedStub(texts: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const t of texts) out.set(t, stubEmbed(t));
  return out;
}

async function main(): Promise<void> {
  console.log(
    `[refresh] capturing embed texts (mode: ${useReal ? "real" : "stub"})…`,
  );
  const texts = [...(await captureTexts())].sort();
  console.log(`[refresh] ${String(texts.length)} distinct texts to embed`);

  const vectors = useReal ? await embedReal(texts) : embedStub(texts);

  const byText: Record<string, number[]> = {};
  for (const t of texts) {
    const vec = vectors.get(t);
    if (!vec) throw new Error(`no embedding produced for a captured text`);
    // Round to keep the committed JSON compact and diff-stable without
    // meaningfully perturbing cosine distance.
    byText[hashText(t)] = vec.map((x) => Number(x.toFixed(6)));
  }

  const model = useReal ? await resolveEmbedModelId() : STUB_MODEL;
  const frozen: FrozenEmbeddings = {
    model,
    dim: EMBED_DIM,
    ...(useReal
      ? {}
      : {
          note:
            "REGENERATE-ME: stub (lexical hashing) embeddings — no semantic " +
            "recall. Run `pnpm eval:refresh:real` with an AI key to freeze real " +
            "embeddings, then re-baseline with `pnpm eval:baseline`.",
        }),
    byText,
  };

  writeFileSync(OUT, JSON.stringify(frozen) + "\n");
  console.log(
    `[refresh] wrote ${String(Object.keys(byText).length)} embeddings (model=${model}) → ${OUT.pathname}`,
  );
}

// The real embed model id, for provenance in the fixture header.
async function resolveEmbedModelId(): Promise<string> {
  try {
    const { resolveModels } = await import("../../ai");
    const { embed } = await resolveModels();
    return embed.id;
  } catch {
    return "unknown-real-embed-model";
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
