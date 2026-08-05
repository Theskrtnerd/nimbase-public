import "server-only";

import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";

import type { SourceProviderAccess } from "@acme/api/provider-access";
import type {
  ProviderAccessPolicyDefinition,
  SourceMetadata,
  SourceStatus,
} from "@acme/db/schema";
import { persistSourceProviderAccessPolicy } from "@acme/api/provider-access";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { CompileJob, Source } from "@acme/db/schema";
import { buildRawMd } from "@acme/runtime/raw-md";
import * as s3 from "@acme/runtime/s3";

import { dispatchCompile } from "~/server/compile/dispatch";
import {
  findDuplicateSourceId,
  findProviderResourceDuplicateSourceId,
  reserveCapture,
} from "./reserve-capture";

export interface IngestInput {
  kind: "web" | "chat_export" | "highlight" | "file";
  sourceUrl?: string;
  title?: string;
  text?: string;
  capturedAt?: string;
  idempotencyKey?: string;
  metadata?: SourceMetadata;
  // Scheduled-crawl provenance (null/absent for a manual capture).
  connectionId?: string | null;
  externalId?: string | null;
  // The crawl runtime resolves resource-level observations before ingestion.
  providerAccess?: SourceProviderAccess;
  // Protocol-v1 compatibility: item-level policies are mirrored to an
  // item-scoped resource during ingestion.
  providerAccessPolicy?: ProviderAccessPolicyDefinition;
  // When true, a unique (workspaceId, idempotencyKey) collision is a no-op
  // "skip" instead of an error. The crawl re-ingest path relies on this: an
  // unchanged item hashes to the same idempotencyKey and must cost nothing.
  skipIfDuplicate?: boolean;
}

export interface IngestContext {
  workspaceId: string;
  // Clerk user id, or null for the ApiToken path (no user).
  userId: string | null;
  // Target folder for the gardener to fence to (null = workspace root).
  targetFolderId: string | null;
}

export interface IngestResult {
  sourceId: string;
  // "skipped" only occurs on the dedup path (skipIfDuplicate) when the item's
  // idempotencyKey already exists — nothing was written or compiled.
  status: "held" | "queued" | "skipped";
}

// Best-effort display name resolved at capture time so the read path never
// needs Clerk. A Clerk hiccup must not block ingest.
export async function resolveCapturedByName(
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (
      user.fullName ??
      user.primaryEmailAddress?.emailAddress ??
      user.username ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Capture a source into a workspace: insert the row, store the raw payload in
 * S3, create a compile job, and enqueue it. Auth-agnostic — the caller must
 * have already authorized `userId` for `workspaceId`.
 */
export async function ingestSource(
  input: IngestInput,
  ctx: IngestContext,
): Promise<IngestResult> {
  const { workspaceId, userId, targetFolderId } = ctx;

  // The original is exactly what was captured — no Nimbase templating.
  const originalBody = input.text ?? input.sourceUrl ?? "";
  const bodyBytes = Buffer.byteLength(originalBody);
  const contentHash = createHash("sha256").update(originalBody).digest("hex");
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : null;
  if (input.providerAccess && input.providerAccessPolicy) {
    throw new Error(
      "Provider source cannot use resolved and item-level access together",
    );
  }
  const accessPolicy =
    input.providerAccess ??
    (input.providerAccessPolicy
      ? await persistSourceProviderAccessPolicy({
          workspaceId,
          connectionId: input.connectionId,
          externalId: input.externalId,
          definition: input.providerAccessPolicy,
        })
      : null);
  // Resource-level ACL transitions have their own governance history and must
  // not duplicate unchanged source bytes. The fingerprint suffix remains only
  // for protocol-v1 item policies that cannot report ACL-only observations.
  const idempotencyKey = input.idempotencyKey
    ? input.providerAccess
      ? `${input.idempotencyKey}:resource`
      : `${input.idempotencyKey}:${accessPolicy?.fingerprint ?? "manual"}`
    : null;

  // Crawl re-ingest dedup: a cheap indexed lookup up front so an unchanged item
  // (same idempotencyKey) costs nothing — no limit checks, no Clerk lookup, no
  // S3, no compile. Per-connection crawls are serialized (flowControl) and the
  // key embeds the connectionId, so nothing else races this key; the insert
  // below still uses onConflictDoNothing as the authoritative guard.
  if (input.skipIfDuplicate && idempotencyKey) {
    const existingId = input.providerAccess
      ? await findProviderResourceDuplicateSourceId(
          workspaceId,
          input.idempotencyKey ?? idempotencyKey,
        )
      : await findDuplicateSourceId(workspaceId, idempotencyKey);
    if (existingId) return { sourceId: existingId, status: "skipped" };
  }

  // Text kinds need no async extraction — raw.md is assembled synchronously
  // right here from the same body plus a metadata frontmatter block.
  const rawMd = buildRawMd({
    kind: input.kind,
    title: input.title ?? null,
    body: originalBody,
    metadata: input.metadata,
    sizeBytes: bodyBytes,
    contentHash,
    capturedAt,
  });

  // Plan limits, id, S3 key, and capturer name — shared with the binary paths.
  const { sourceId, originalKey, capturedByName } = await reserveCapture({
    workspaceId,
    userId,
    sizeBytes: bodyBytes,
    ext: "md",
  });
  const rawMdKey = s3.s3KeyFor.rawMdSource(workspaceId, sourceId);
  const sourceStatus: SourceStatus = accessPolicy ? "held" : "queued";

  const rowValues = {
    id: sourceId,
    workspaceId,
    kind: input.kind,
    sourceUrl: input.sourceUrl ?? null,
    title: input.title ?? null,
    s3KeyOriginal: originalKey,
    s3KeyRawMd: rawMdKey,
    sizeBytes: bodyBytes,
    contentHash,
    status: sourceStatus,
    metadata: input.metadata ?? null,
    capturedAt,
    idempotencyKey,
    capturedByUserId: userId,
    capturedByName,
    targetFolderId,
    connectionId: input.connectionId ?? null,
    externalId: input.externalId ?? null,
    accessPolicyId: accessPolicy?.policyId ?? null,
    accessResourceId: accessPolicy?.resourceId ?? null,
  };

  if (input.skipIfDuplicate) {
    // Crawl re-ingest: insert first so an existing idempotencyKey short-circuits
    // to a no-op skip — no S3 writes, no compile, no spend — for unchanged items.
    const [row] = await db
      .insert(Source)
      .values(rowValues)
      .onConflictDoNothing({
        target: [Source.workspaceId, Source.idempotencyKey],
      })
      .returning({ id: Source.id });
    if (!row) {
      return { sourceId, status: "skipped" };
    }
    await Promise.all([
      s3.putObject(originalKey, originalBody, "text/markdown"),
      s3.putObject(rawMdKey, rawMd, "text/markdown"),
    ]);
  } else {
    // Three independent writes: insert the row, upload the original, upload
    // raw.md. Compile only reads the row and raw.md, so the enqueue joins all.
    await Promise.all([
      db.insert(Source).values(rowValues),
      s3.putObject(originalKey, originalBody, "text/markdown"),
      s3.putObject(rawMdKey, rawMd, "text/markdown"),
    ]);
  }

  if (accessPolicy) {
    return { sourceId, status: "held" };
  }

  const [job] = await db
    .insert(CompileJob)
    .values({ workspaceId, sourceId })
    .returning({ id: CompileJob.id });

  if (job) {
    try {
      await dispatchCompile({ jobId: job.id, workspaceId, sourceId });
    } catch (err) {
      // A QStash outage here used to leave the Source at "queued" plus an
      // orphan CompileJob at "queued" that nothing would ever run — and
      // Mark both failed so the row is visibly broken and re-eligible instead of
      // silently stuck, then rethrow so the caller still sees the outage.
      const message = err instanceof Error ? err.message : String(err);
      await Promise.all([
        db
          .update(CompileJob)
          .set({
            status: "failed",
            error: `enqueue failed: ${message}`,
            finishedAt: new Date(),
          })
          .where(eq(CompileJob.id, job.id)),
        db
          .update(Source)
          .set({ status: "failed", error: `enqueue failed: ${message}` })
          .where(eq(Source.id, sourceId)),
      ]);
      throw err;
    }
  }

  return { sourceId, status: "queued" };
}
