import type { GrantRole } from "@acme/db/schema";
import { and, eq, inArray } from "@acme/db";
import { db, setDbOverride } from "@acme/db/client";
import { WikiNode, Workspace } from "@acme/db/schema";

import type { Embedder } from "../../embed";
import type { ProviderAccessContext } from "../context";
import type { MemoryProvider } from "../provider";
import type { FixtureNote } from "./fixtures/notes";
import type { EvalDb } from "./pglite-db";
import { setEmbedderForTesting } from "../../embed";
import { setObjectStoreForTesting } from "../../s3";
import { toProviderContext } from "../context";
import { memoryProvider } from "../wiki-pg-provider";
import { FIXTURE_NOTES } from "./fixtures/notes";
import { stableRanking } from "./metrics";
import { createEvalDb } from "./pglite-db";

// A scoped access context for the eval: "admin" sees the whole workspace; a
// prefix-excluding reader models a caller with no grant into the restricted
// board subtree (the scope-leak cases). Built through the real
// `toProviderContext` so the derived toolsets + SQL-side scopes are exactly what
// production computes.
export function adminContext(workspaceId: string): ProviderAccessContext {
  return toProviderContext({
    workspaceId,
    userId: "eval-admin",
    scopes: () => null,
  });
}

// A reader scoped to everything EXCEPT the given restricted prefixes. Read
// toolset only (capture/admin withheld) — enough to exercise search under a
// boundary.
export function readerExcept(
  workspaceId: string,
  excludePrefixes: string[],
): ProviderAccessContext {
  const readScopes = [{ prefix: "", exclude: excludePrefixes }];
  const byRole: Record<GrantRole, typeof readScopes | []> = {
    viewer: readScopes,
    contributor: [],
    manager: [],
  };
  return toProviderContext({
    workspaceId,
    userId: "eval-reader",
    scopes: (minRole: GrantRole) => byRole[minRole],
  });
}

export interface EvalEnv extends EvalDb {
  workspaceId: string;
  provider: MemoryProvider;
  // path → seeded node id, for turning relevance judgments into id sets.
  idByPath: Map<string, string>;
  teardown: () => Promise<void>;
}

// Stand up a PGlite-backed environment, point @acme/db/client + the embed + s3
// seams at it, seed the fixture corpus through the REAL provider.upsert (the
// seam's first production caller), and return handles for running queries.
export async function setupEval(embedder: Embedder): Promise<EvalEnv> {
  const store = new Map<string, string>();
  const evalDb = await createEvalDb();
  setDbOverride(evalDb.db);
  setObjectStoreForTesting(store);
  setEmbedderForTesting(embedder);

  const [ws] = await evalDb.db
    .insert(Workspace)
    .values({
      name: "Cadence (eval)",
      slug: "cadence-eval",
      ownerUserId: "eval-admin",
    })
    .returning({ id: Workspace.id });
  if (!ws) throw new Error("failed to insert eval workspace");
  const workspaceId = ws.id;

  await seedNotes(workspaceId, FIXTURE_NOTES);

  const idByPath = new Map<string, string>();
  const rows = await evalDb.db
    .select({ id: WikiNode.id, path: WikiNode.path })
    .from(WikiNode)
    .where(eq(WikiNode.workspaceId, workspaceId));
  for (const r of rows) idByPath.set(r.path, r.id);

  const teardown = async (): Promise<void> => {
    setEmbedderForTesting(null);
    setObjectStoreForTesting(null);
    setDbOverride(null);
    await evalDb.close();
  };

  return {
    ...evalDb,
    workspaceId,
    provider: memoryProvider,
    idByPath,
    teardown,
  };
}

// Seed fixtures through provider.upsert, then mark the restricted subtree so the
// node's boundary matches a real permission anchor (fidelity only — the eval's
// scope enforcement is the SQL path filter, not this flag).
async function seedNotes(
  workspaceId: string,
  notes: FixtureNote[],
): Promise<void> {
  const ctx = adminContext(workspaceId);
  for (const note of notes) {
    await memoryProvider.upsert(ctx, {
      kind: note.kind,
      title: note.title,
      content: note.content,
      path: note.path,
    });
  }

  const restrictedPaths = notes.filter((n) => n.restricted).map((n) => n.path);
  if (restrictedPaths.length > 0) {
    await db
      .update(WikiNode)
      .set({ restricted: true })
      .where(
        and(
          eq(WikiNode.workspaceId, workspaceId),
          inArray(WikiNode.path, restrictedPaths),
        ),
      );
  }
}

// Run one query through the provider and return a stable id ranking (best
// first). The stable tiebreak makes two runs over identical data agree even
// where the SQL leaves equal RRF scores unordered.
export async function rankedIds(
  provider: MemoryProvider,
  ctx: ProviderAccessContext,
  text: string,
  limit = 20,
): Promise<string[]> {
  const hits = await provider.search(ctx, { text, limit });
  return stableRanking(
    hits.map((h) => ({ nodeId: h.node.id, score: h.score })),
  );
}
