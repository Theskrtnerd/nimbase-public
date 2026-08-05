import "server-only";

import { createHash } from "node:crypto";

import type {
  ProviderAccessPolicyDefinition,
  SourceMetadata,
} from "@acme/db/schema";
import { persistSourceProviderAccessPolicy } from "@acme/api/provider-access";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Source } from "@acme/db/schema";
import * as s3 from "@acme/runtime/s3";

import { dispatchExtract } from "./extract-dispatch";
import { findDuplicateSourceId, reserveCapture } from "./reserve-capture";
import { isZipSource } from "./zip-entries";

type BinaryIngestKind = "screenshot" | "voice" | "video" | "file";

// mime → raw-key extension, per kind. Doubles as the allowlist: a mime
// missing here is rejected at presign, before any row or URL exists.
const EXT_FOR_MIME: Record<
  "screenshot" | "voice" | "video",
  Record<string, string>
> = {
  screenshot: {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  },
  voice: {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
  },
  video: {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
  },
};

// "file" covers everything that isn't a screenshot/voice/video — from plain
// text (decoded straight to raw.md, no AI call) to arbitrary documents (PDF,
// docx, zip, ...), which get a metadata-only raw.md until we have a real
// extraction path for them (see extract.ts's TEXT_NATIVE_MIME fallback). The
// original keeps its real extension (from originalFilename), not a
// mime-derived one — so any mime is accepted as long as a filename is given.

const MAX_SIZE_BYTES: Record<BinaryIngestKind, number> = {
  screenshot: 15 * 1024 * 1024,
  voice: 25 * 1024 * 1024,
  video: 20 * 1024 * 1024,
  file: 20 * 1024 * 1024,
};

// A .zip is a bulk import — one upload standing in for a whole directory — so
// it gets a higher ceiling than a single document. The real bound on what an
// archive can do to a workspace is the per-entry/total/count caps applied at
// expansion time (see expand-zip.ts), not this number.
const MAX_ZIP_BYTES = 100 * 1024 * 1024;

function maxSizeFor(input: PresignInput): number {
  return isZipSource({
    kind: input.kind,
    mimeType: input.mimeType,
    originalFilename: input.originalFilename ?? null,
  })
    ? MAX_ZIP_BYTES
    : MAX_SIZE_BYTES[input.kind];
}

export class BinaryIngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PresignInput {
  kind: BinaryIngestKind;
  mimeType: string;
  title?: string;
  sourceUrl?: string;
  capturedAt?: string;
  sizeBytes: number;
  // The real captured filename — required for "file" (drives its extension),
  // optional for screenshot/voice (the extension already synthesizes one).
  originalFilename?: string;
}

export interface BinaryIngestContext {
  workspaceId: string;
  // Clerk user id, or null for the ApiToken path (no user).
  userId: string | null;
  // Target folder for the gardener to fence to (null = workspace root).
  targetFolderId: string | null;
}

export interface BinaryBytesIngestInput extends PresignInput {
  bytes: Uint8Array;
  metadata?: SourceMetadata;
  connectionId?: string | null;
  externalId?: string | null;
  idempotencyKey?: string;
  skipIfDuplicate?: boolean;
  providerAccessPolicy?: ProviderAccessPolicyDefinition;
}

function extensionFor(input: PresignInput): string {
  if (input.kind === "file") {
    const match = /\.([a-z0-9]+)$/i.exec(input.originalFilename ?? "");
    const ext = match?.[1];
    if (!ext) throw new BinaryIngestError("filename_required", 400);
    return ext.toLowerCase();
  }
  const ext = EXT_FOR_MIME[input.kind][input.mimeType];
  if (!ext) throw new BinaryIngestError("unsupported_mime", 400);
  return ext;
}

/**
 * Phase 1 of binary capture: validate, create the Source row in "uploading",
 * and hand the extension a presigned PUT URL. The row id is generated here so
 * the S3 key is known before the insert (same trick as ingestSource).
 */
export async function presignBinarySource(
  input: PresignInput,
  ctx: BinaryIngestContext,
): Promise<{ sourceId: string; uploadUrl: string }> {
  const ext = extensionFor(input);
  if (input.sizeBytes <= 0 || input.sizeBytes > maxSizeFor(input)) {
    throw new BinaryIngestError("invalid_size", 400);
  }

  // Plan limits, id, S3 key, and capturer name. finalize stays unmetered
  // (idempotent, already gated here).
  const { sourceId, originalKey, capturedByName } = await reserveCapture({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    sizeBytes: input.sizeBytes,
    ext,
  });
  const uploadUrl = await s3.presignPutUrl(originalKey, input.mimeType);

  await db.insert(Source).values({
    id: sourceId,
    workspaceId: ctx.workspaceId,
    kind: input.kind,
    sourceUrl: input.sourceUrl ?? null,
    title: input.title ?? null,
    s3KeyOriginal: originalKey,
    originalFilename: input.originalFilename ?? null,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
    status: "uploading",
    capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
    capturedByUserId: ctx.userId,
    capturedByName,
    targetFolderId: ctx.targetFolderId,
  });

  return { sourceId, uploadUrl };
}

/**
 * Phase 2: after the extension/CLI PUT, confirm the object landed, flip the
 * row to "extracting", and dispatch the extract job (which turns the
 * original into raw.md, then hands off to compile itself). Idempotent — a
 * repeat call on a source already past "uploading" is a successful no-op.
 */
export async function finalizeBinarySource(
  sourceId: string,
  ctx: BinaryIngestContext,
): Promise<{ sourceId: string; status: "extracting" }> {
  const [source] = await db
    .select({
      id: Source.id,
      status: Source.status,
      s3KeyOriginal: Source.s3KeyOriginal,
    })
    .from(Source)
    .where(
      and(eq(Source.id, sourceId), eq(Source.workspaceId, ctx.workspaceId)),
    )
    .limit(1);
  if (!source) throw new BinaryIngestError("not_found", 404);
  if (source.status !== "uploading") return { sourceId, status: "extracting" };

  if (!(await s3.headObject(source.s3KeyOriginal))) {
    throw new BinaryIngestError("upload_missing", 409);
  }

  await db
    .update(Source)
    .set({ status: "extracting" })
    .where(eq(Source.id, sourceId));

  await dispatchExtract({
    // The extract job creates and dispatches the CompileJob itself once
    // raw.md is ready — jobId here just identifies the extract dispatch.
    jobId: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    sourceId,
  });
  return { sourceId, status: "extracting" };
}

/**
 * Server-to-server binary capture. Drive and future pull connectors already
 * hold the bytes, so routing them through a client-facing presigned PUT would
 * add a needless network round trip. This keeps the same limits, Source shape,
 * extraction dispatch, and idempotency semantics as the public two-phase flow.
 */
export async function ingestBinaryBytes(
  input: BinaryBytesIngestInput,
  ctx: BinaryIngestContext,
): Promise<{ sourceId: string; status: "extracting" | "skipped" }> {
  const sizeBytes = input.bytes.byteLength;
  const ext = extensionFor(input);
  if (sizeBytes <= 0 || sizeBytes > maxSizeFor({ ...input, sizeBytes })) {
    throw new BinaryIngestError("invalid_size", 400);
  }
  const accessPolicy = input.providerAccessPolicy
    ? await persistSourceProviderAccessPolicy({
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        connectionId: input.connectionId,
        externalId: input.externalId,
        definition: input.providerAccessPolicy,
      })
    : null;
  const idempotencyKey = input.idempotencyKey
    ? `${input.idempotencyKey}:${accessPolicy?.fingerprint ?? "manual"}`
    : null;
  if (input.skipIfDuplicate && idempotencyKey) {
    const existingId = await findDuplicateSourceId(
      ctx.workspaceId,
      idempotencyKey,
    );
    if (existingId) return { sourceId: existingId, status: "skipped" };
  }

  const { sourceId, originalKey, capturedByName } = await reserveCapture({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    sizeBytes,
    ext,
  });
  const [row] = await db
    .insert(Source)
    .values({
      id: sourceId,
      workspaceId: ctx.workspaceId,
      kind: input.kind,
      sourceUrl: input.sourceUrl ?? null,
      title: input.title ?? null,
      s3KeyOriginal: originalKey,
      originalFilename: input.originalFilename ?? null,
      sizeBytes,
      mimeType: input.mimeType,
      status: "extracting",
      contentHash: createHash("sha256").update(input.bytes).digest("hex"),
      metadata: input.metadata ?? null,
      capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
      idempotencyKey,
      capturedByUserId: ctx.userId,
      capturedByName,
      targetFolderId: ctx.targetFolderId,
      connectionId: input.connectionId ?? null,
      externalId: input.externalId ?? null,
      accessPolicyId: accessPolicy?.id ?? null,
    })
    .onConflictDoNothing({
      target: [Source.workspaceId, Source.idempotencyKey],
    })
    .returning({ id: Source.id });
  if (!row) return { sourceId, status: "skipped" };

  try {
    await s3.putObject(originalKey, input.bytes, input.mimeType);
    await dispatchExtract({
      jobId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      sourceId,
    });
  } catch (error) {
    // The idempotency key would otherwise make every future connector scan
    // skip this source even though its bytes/job never landed. This row was
    // created by this call and has not become user-visible evidence yet.
    await db.delete(Source).where(eq(Source.id, sourceId));
    throw error;
  }
  return { sourceId, status: "extracting" };
}
