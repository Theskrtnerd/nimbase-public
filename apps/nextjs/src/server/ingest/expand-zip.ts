import "server-only";

import type { ExtractJobData } from "@acme/runtime/queue";
import { assertWithinLimit } from "@acme/api/entitlements";
import { db } from "@acme/db/client";
import { Source } from "@acme/db/schema";
import * as s3 from "@acme/runtime/s3";

import type { ExpandZipResult } from "./zip-entries";
import { selectZipEntries } from "./zip-entries";

// A .zip is transport, not content: it carries a slice of someone's existing
// file system into the workspace. Expansion turns one uploaded archive into
// one Source per entry, each of which then flows through the ordinary
// extract → compile pipeline. The container itself never becomes a note.
// The rules for *which* entries qualify are in zip-entries.ts.
//
// This module only creates rows and objects and *returns* the child jobs — it
// never dispatches them. Dispatch is the worker's job (extract-dispatch.ts),
// which keeps the dependency one-way: expand-zip must not import the dispatcher
// that imports the extract worker that imports expand-zip.

/**
 * Expands an uploaded archive into one child Source per entry. Each child is
 * written to S3 under its own id and inserted directly in "extracting" (its
 * bytes are already stored, so it skips presign/finalize). Children inherit the
 * container's target folder and capturer, so the compile fence and provenance
 * are unchanged. The extract jobs for the children are returned, not
 * dispatched — the caller owns that.
 */
export async function expandZipSource(
  container: typeof Source.$inferSelect,
  archive: Uint8Array,
): Promise<ExpandZipResult> {
  const { entries, skipped } = selectZipEntries(archive);
  const workspaceId = container.workspaceId;

  const childJobs: ExtractJobData[] = [];
  let limitReached: string | null = null;

  for (const entry of entries) {
    // Each child is a capture in its own right, so it's metered like one. A
    // limit part-way through stops the expansion rather than failing the whole
    // archive — what already landed stays landed.
    try {
      await assertWithinLimit(workspaceId, "captures");
      await assertWithinLimit(workspaceId, "storage", entry.bytes.length);
    } catch (err) {
      limitReached = err instanceof Error ? err.message : String(err);
      break;
    }

    const childId = crypto.randomUUID();
    const originalKey = s3.s3KeyFor.originalSource(
      workspaceId,
      childId,
      entry.ext || "bin",
    );
    await s3.putObject(originalKey, entry.bytes, entry.mimeType);

    await db.insert(Source).values({
      id: childId,
      workspaceId,
      kind: "file",
      sourceUrl: null,
      title: entry.path,
      s3KeyOriginal: originalKey,
      originalFilename: entry.path.split("/").pop() ?? entry.path,
      sizeBytes: entry.bytes.length,
      mimeType: entry.mimeType,
      // The bytes are already in S3 — there is no upload phase to wait on.
      status: "extracting",
      capturedAt: container.capturedAt,
      capturedByUserId: container.capturedByUserId,
      capturedByName: container.capturedByName,
      targetFolderId: container.targetFolderId,
      connectionId: container.connectionId,
      externalId: container.externalId
        ? `${container.externalId}:${entry.path}`
        : null,
      accessPolicyId: container.accessPolicyId,
      accessResourceId: container.accessResourceId,
      metadata: { archiveSourceId: container.id, archivePath: entry.path },
    });

    childJobs.push({
      jobId: crypto.randomUUID(),
      workspaceId,
      sourceId: childId,
    });
  }

  return { childCount: childJobs.length, childJobs, skipped, limitReached };
}
