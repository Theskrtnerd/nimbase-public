import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { SpendLedger, WikiChunk } from "@acme/db/schema";

import { chunkMarkdown } from "./chunk";
import { embedChunks } from "./embed";

// Embed a single note/dataset version into wiki_chunk. Idempotent: replaces
// any existing chunks for this version. Used by the compile job and the
// backfill.
//
// Notes are chunked from their markdown body (heading-aware). Datasets are
// chunked from their summary instead — raw JSON numbers don't embed
// meaningfully for semantic search, but a description of what the data
// represents does. The raw JSON stays retrievable in full via get_note;
// search just needs to be able to find the dataset in the first place.
export async function indexNodeVersion(args: {
  nodeVersionId: string;
  workspaceId: string;
  kind?: "note" | "dataset";
  body: string;
  summary?: string | null;
  jobId?: string;
}): Promise<void> {
  const {
    nodeVersionId,
    workspaceId,
    kind = "note",
    body,
    summary,
    jobId,
  } = args;

  const chunks = chunkMarkdown(kind === "dataset" ? (summary ?? "") : body);

  // Replace prior chunks for this version (idempotent re-index).
  await db.delete(WikiChunk).where(eq(WikiChunk.nodeVersionId, nodeVersionId));

  if (chunks.length === 0) return;

  const { embeddings, tokens } = await embedChunks(chunks.map((c) => c.text));

  type InsertRow = typeof WikiChunk.$inferInsert;
  const rows: InsertRow[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];
    if (!chunk || !embedding) continue;
    rows.push({
      nodeVersionId,
      workspaceId,
      ord: chunk.ord,
      text: chunk.text,
      embedding,
    });
  }

  // Nothing to insert (e.g. embeddings misaligned with chunks) — Drizzle
  // throws on an empty values() array, so bail before the insert + ledger.
  if (rows.length === 0) return;

  await db.insert(WikiChunk).values(rows);

  // Coarse embed-cost ledger entry ($0.02 / 1M tokens -> cents). Often rounds
  // to 0 at small sizes; kept as the cost-tracking hook.
  await db.insert(SpendLedger).values({
    workspaceId,
    kind: "embed",
    cents: Math.round((tokens / 1_000_000) * 2),
    jobId: jobId ?? null,
  });
}
