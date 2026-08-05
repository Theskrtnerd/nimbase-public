import "server-only";

import { assertWithinLimit } from "@acme/api/entitlements";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Source } from "@acme/db/schema";
import * as s3 from "@acme/runtime/s3";

import { resolveCapturedByName } from "./ingest-source";

/**
 * The preamble every capture path runs before it writes anything, factored out
 * of ingestSource / presignBinarySource / ingestBinaryBytes.
 *
 * Deliberately NOT a unified "create a Source" helper: the three paths build
 * genuinely different rows (text captures carry contentHash + raw.md and land
 * in "queued"; binary captures carry mimeType + originalFilename and land in
 * "uploading" or "extracting"), and collapsing those would be a worse
 * abstraction than the duplication. What they actually share is this: check the
 * plan limits, mint the id, derive the S3 key from it, and resolve the
 * capturer's display name.
 *
 * The id is generated here rather than by the DB default so the S3 key is known
 * before the insert, which lets the uploads run concurrently with it.
 */
export async function reserveCapture(args: {
  workspaceId: string;
  // Clerk user id, or null for the ApiToken path (no user).
  userId: string | null;
  sizeBytes: number;
  // Extension for the original object's key ("md" for text captures).
  ext: string;
}): Promise<{
  sourceId: string;
  originalKey: string;
  capturedByName: string | null;
}> {
  await Promise.all([
    assertWithinLimit(args.workspaceId, "captures"),
    assertWithinLimit(args.workspaceId, "storage", args.sizeBytes),
  ]);
  const sourceId = crypto.randomUUID();
  const originalKey = s3.s3KeyFor.originalSource(
    args.workspaceId,
    sourceId,
    args.ext,
  );
  const capturedByName = await resolveCapturedByName(args.userId);
  return { sourceId, originalKey, capturedByName };
}

/**
 * The cheap indexed pre-check the re-ingest paths run so an unchanged item
 * costs nothing — no limit checks, no Clerk lookup, no S3, no job.
 *
 * This is an optimisation, not the guard: the authoritative one is the
 * onConflictDoNothing on (workspaceId, idempotencyKey) at insert time, because
 * two callers can pass this check concurrently.
 */
export async function findDuplicateSourceId(
  workspaceId: string,
  idempotencyKey: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: Source.id })
    .from(Source)
    .where(
      and(
        eq(Source.workspaceId, workspaceId),
        eq(Source.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}
