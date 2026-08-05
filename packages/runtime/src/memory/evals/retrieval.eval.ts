// Retrieval regression eval — the SECOND consumer of the MemoryProvider seam
// (it drives only `provider.upsert` + `provider.search`, never WikiPgProvider
// internals). Runs the UNMODIFIED production search SQL over a PGlite-backed
// drizzle handle, seeded through the real provider, with FROZEN committed
// embeddings so it is offline, deterministic, and needs no AI key.
//
// Out of the default `pnpm test` glob (named *.eval.ts) — run via `pnpm eval`.
// Fails if recall@5 or MRR drops below the committed baseline (minus a small
// epsilon), or if a restricted-subtree note leaks to an out-of-scope caller.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FrozenEmbeddings } from "./frozen-embeddings";
import type { EvalEnv } from "./harness";
import { FIXTURE_QUERIES } from "./fixtures/queries";
import { frozenEmbedder } from "./frozen-embeddings";
import { adminContext, rankedIds, readerExcept, setupEval } from "./harness";
import { aggregate, scoreQuery } from "./metrics";

const K = 5;
// Metrics may not move at all with frozen embeddings, but allow a hair of slack
// so a benign ranking tie-break never red-lights CI.
const EPSILON = 0.02;

const EMBEDDINGS_URL = new URL("./fixtures/embeddings.json", import.meta.url);
const BASELINE_URL = new URL("./baseline.json", import.meta.url);
const UPDATE_BASELINE = process.env.EVAL_UPDATE_BASELINE === "1";

interface Baseline {
  model: string;
  k: number;
  recallAtK: number;
  mrr: number;
  queries: number;
}

function loadFrozen(): FrozenEmbeddings {
  if (!existsSync(EMBEDDINGS_URL)) {
    throw new Error(
      "Missing fixtures/embeddings.json — run `pnpm eval:refresh` first.",
    );
  }
  return JSON.parse(readFileSync(EMBEDDINGS_URL, "utf8")) as FrozenEmbeddings;
}

function contextFor(env: EvalEnv, query: (typeof FIXTURE_QUERIES)[number]) {
  return query.context === "no-board"
    ? readerExcept(env.workspaceId, ["restricted/board"])
    : adminContext(env.workspaceId);
}

describe("retrieval eval (PGlite + frozen embeddings)", () => {
  let env: EvalEnv;
  let frozen: FrozenEmbeddings;
  let teardown: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    frozen = loadFrozen();
    env = await setupEval(frozenEmbedder(frozen));
    teardown = env.teardown;
  });

  afterAll(async () => {
    await teardown?.();
  });

  it("seeded every fixture note through provider.upsert", () => {
    // Every judged/forbidden path must have a real seeded id.
    const paths = new Set<string>();
    for (const q of FIXTURE_QUERIES) {
      for (const p of q.relevant) paths.add(p);
      for (const p of q.forbidden ?? []) paths.add(p);
    }
    for (const p of paths) expect(env.idByPath.get(p), p).toBeTruthy();
  });

  it("meets or beats the committed recall@5 + MRR baseline", async () => {
    const scores = [];
    for (const q of FIXTURE_QUERIES) {
      if (q.relevant.length === 0) continue; // scope-leak-only queries
      const ctx = contextFor(env, q);
      const ranking = await rankedIds(env.provider, ctx, q.text);
      const relevantIds = q.relevant.map((p) => mustId(env, p));
      scores.push(scoreQuery(ranking, relevantIds, K));
    }
    const agg = aggregate(scores);
    console.log(
      `[eval] recall@${String(K)}=${agg.recallAtK.toFixed(4)} ` +
        `mrr=${agg.mrr.toFixed(4)} over ${String(agg.queries)} queries ` +
        `(embeddings: ${frozen.model})`,
    );

    if (UPDATE_BASELINE) {
      const baseline: Baseline = {
        model: frozen.model,
        k: K,
        recallAtK: Number(agg.recallAtK.toFixed(4)),
        mrr: Number(agg.mrr.toFixed(4)),
        queries: agg.queries,
      };
      writeFileSync(BASELINE_URL, JSON.stringify(baseline, null, 2) + "\n");
      console.log("[eval] baseline updated");
      return;
    }

    const baseline = JSON.parse(readFileSync(BASELINE_URL, "utf8")) as Baseline;
    if (baseline.model !== frozen.model || baseline.k !== K) {
      throw new Error(
        `baseline.json (model=${baseline.model}, k=${String(baseline.k)}) does not match ` +
          `the frozen embeddings (model=${frozen.model}, k=${String(K)}) — ` +
          `re-baseline with \`pnpm eval:baseline\` after refreshing embeddings`,
      );
    }
    expect(agg.recallAtK).toBeGreaterThanOrEqual(baseline.recallAtK - EPSILON);
    expect(agg.mrr).toBeGreaterThanOrEqual(baseline.mrr - EPSILON);
  });

  it("never returns a restricted board note to an out-of-scope caller", async () => {
    const leakQueries = FIXTURE_QUERIES.filter((q) => q.forbidden?.length);
    expect(leakQueries.length).toBeGreaterThan(0);
    for (const q of leakQueries) {
      const ctx = readerExcept(env.workspaceId, ["restricted/board"]);
      const ranking = await rankedIds(env.provider, ctx, q.text);
      const forbiddenIds = new Set(
        (q.forbidden ?? []).map((p) => mustId(env, p)),
      );
      const leaked = ranking.filter((id) => forbiddenIds.has(id));
      expect(leaked, `${q.id} leaked restricted ids`).toEqual([]);
    }
  });

  it("DOES surface the same board notes to an in-scope (admin) caller", async () => {
    // Proves the leak test above is filtering on scope, not on a broken query.
    for (const q of FIXTURE_QUERIES) {
      if (q.context !== "admin" || q.relevant.length === 0) continue;
      if (!q.relevant.some((p) => p.startsWith("restricted/board/"))) continue;
      const ranking = await rankedIds(
        env.provider,
        adminContext(env.workspaceId),
        q.text,
      );
      const relevantIds = q.relevant.map((p) => mustId(env, p));
      const hit = ranking.slice(0, K).some((id) => relevantIds.includes(id));
      expect(hit, `admin should retrieve ${q.relevant.join(",")}`).toBe(true);
    }
  });

  it("is deterministic: two consecutive runs of the full set agree", async () => {
    const run = async (): Promise<string[][]> => {
      const out: string[][] = [];
      for (const q of FIXTURE_QUERIES) {
        const ctx = contextFor(env, q);
        out.push(await rankedIds(env.provider, ctx, q.text, K));
      }
      return out;
    };
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
  });
});

// Every judged path must resolve to a seeded id — a missing one is a fixture
// bug, not a retrieval miss, so fail loudly rather than score a phantom.
function mustId(env: EvalEnv, path: string): string {
  const id = env.idByPath.get(path);
  if (!id) throw new Error(`fixture query references unseeded path "${path}"`);
  return id;
}
