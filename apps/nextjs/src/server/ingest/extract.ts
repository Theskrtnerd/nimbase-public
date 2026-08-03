import "server-only";

import { createHash } from "node:crypto";

import type { ExtractJobData } from "@acme/cloud";
import type { SourceMetadata } from "@acme/db/schema";
import {
  buildRawMd,
  costFor,
  extractBinaryText,
  isParseableMime,
  parseBytes,
  parseConfigured,
  s3,
} from "@acme/cloud";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { CompileJob, Source, SpendLedger } from "@acme/db/schema";

import { dispatchCompile } from "~/server/compile/dispatch";
import { expandZipSource } from "./expand-zip";
import { buildArchiveManifest, isZipSource } from "./zip-entries";

// "file" sources in this text-native mime set decode straight to raw.md — no
// AI call, no vendor call. Richer formats (PDF, docx, xlsx, pptx, code, data,
// images) go through Context.dev Parse; anything left over falls back to a
// metadata-only raw.md, so capture still succeeds instead of failing.
const TEXT_NATIVE_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

const DEFAULT_MIME_FOR_KIND: Record<"screenshot" | "voice" | "video", string> =
  {
    screenshot: "image/png",
    voice: "audio/webm",
    video: "video/mp4",
  };

function noExtractionStub(mimeType: string | null): string {
  return `_No text extraction available for this file type (${mimeType ?? "unknown mime"}) yet — the original is stored and downloadable._`;
}

/**
 * Runs a captured document/image through Context.dev Parse, degrading to the
 * metadata-only stub when the service can't handle it. A source whose bytes
 * are safely stored should never end up "failed" because an extraction vendor
 * was down or rejected the format — the capture is still real, and a later
 * re-extract can fill in the body.
 */
async function parseDocument(
  source: typeof Source.$inferSelect,
  bytes: Uint8Array,
): Promise<{ body: string; extractedBy?: string }> {
  try {
    const result = await parseBytes({
      data: bytes,
      mimeType: source.mimeType ?? "application/octet-stream",
      extension: extensionOf(source.originalFilename),
    });
    // An empty parse (e.g. an image with no text and nothing to describe) is
    // worse than the stub: it would compile a note with no content at all.
    if (result.markdown.trim().length === 0) {
      return { body: noExtractionStub(source.mimeType) };
    }
    return { body: result.markdown, extractedBy: `context.dev:${result.type}` };
  } catch (err) {
    console.error("[extract] context.dev parse failed", {
      sourceId: source.id,
      mimeType: source.mimeType,
      err,
    });
    return { body: noExtractionStub(source.mimeType) };
  }
}

function extensionOf(filename: string | null): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(filename ?? "");
  return match?.[1]?.toLowerCase();
}

/**
 * Serializes a body into the source's raw.md and stores it, returning the key.
 * Every path through processExtractJob ends here — an archive's manifest and an
 * extracted document differ only in what `body` says.
 */
async function writeRawMd(
  workspaceId: string,
  source: typeof Source.$inferSelect,
  body: string,
  contentHash: string,
  metadata: SourceMetadata | null,
): Promise<string> {
  const key = s3.s3KeyFor.rawMdSource(workspaceId, source.id);
  await s3.putObject(
    key,
    buildRawMd({
      kind: source.kind,
      title: source.title,
      body,
      metadata,
      originalFilename: source.originalFilename,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
      contentHash,
      capturedAt: source.capturedAt,
    }),
    "text/markdown",
  );
  return key;
}

/**
 * Turns a captured original (screenshot/voice/video/file) into raw.md:
 * OCR/transcription for screenshot|voice|video, a plain UTF-8 decode for
 * text-native files, and a metadata-only stub for anything else (so capture
 * never fails just because we can't deeply extract that file type yet).
 * Idempotency is gated on Source.status — once it's moved past "extracting"
 * (by an earlier attempt, success or failure), a QStash retry is a no-op, so
 * a retry never re-runs (and re-bills) an AI extraction call.
 *
 * Returns the extract jobs for any children an archive expanded into, for the
 * caller to dispatch — empty for every non-archive source.
 */
export async function processExtractJob(
  data: ExtractJobData,
): Promise<ExtractJobData[]> {
  const { workspaceId, sourceId } = data;

  try {
    const [source] = await db
      .select()
      .from(Source)
      .where(eq(Source.id, sourceId))
      .limit(1);
    if (!source) throw new Error(`source ${sourceId} not found`);
    if (source.status !== "extracting") return [];

    // Provider evidence stays out of the compiler until derived memory can
    // preserve policy changes and pass the security eval suite.
    const compilationHeld = source.accessPolicyId != null;

    const bytes = await s3.getObjectBytes(source.s3KeyOriginal);
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    // An archive is transport, not content: it fans out into one child Source
    // per entry (each of which runs this same pipeline) and then terminates.
    // It deliberately gets no CompileJob — compiling the container would write
    // a "contents of archive.zip" note into memory, which is noise. Marking it
    // "compiled" here is the same idempotency checkpoint as the normal path: a
    // QStash retry sees status !== "extracting" and returns before re-expanding.
    if (isZipSource(source)) {
      const result = await expandZipSource(source, bytes);
      const manifest = buildArchiveManifest(result);
      const manifestKey = await writeRawMd(
        workspaceId,
        source,
        manifest,
        contentHash,
        source.metadata,
      );
      await db
        .update(Source)
        .set({
          s3KeyRawMd: manifestKey,
          contentHash,
          status: compilationHeld ? "held" : "compiled",
          compiledAt: compilationHeld ? null : new Date(),
          // The manifest is the container's whole story; compileReport is what
          // the source detail view renders, so it doesn't also go in metadata.
          compileReport: manifest,
        })
        .where(eq(Source.id, sourceId));
      // The children are dispatched by the caller (extract-dispatch.ts), not
      // here — see expand-zip.ts for why the dependency runs that way.
      return result.childJobs;
    }

    let body: string;
    let extractionModelId: string | undefined;
    let extractedBy: string | undefined;
    if (
      source.kind === "file" &&
      source.mimeType &&
      TEXT_NATIVE_MIME.has(source.mimeType)
    ) {
      body = Buffer.from(bytes).toString("utf8");
    } else if (
      (source.kind === "file" || source.kind === "screenshot") &&
      isParseableMime(source.mimeType) &&
      parseConfigured()
    ) {
      // Documents, code/data files, and images go to Context.dev Parse — the
      // path that turns a PDF or docx into real markdown instead of the
      // metadata-only stub below. Screenshots come here too rather than to
      // extractBinaryText; voice and video can't, since Parse handles neither.
      // A parse failure is not a capture failure: the original is stored and
      // the source still compiles, so we degrade to the stub.
      const parsed = await parseDocument(source, bytes);
      body = parsed.body;
      extractedBy = parsed.extractedBy;
    } else if (
      source.kind === "screenshot" ||
      source.kind === "voice" ||
      source.kind === "video"
    ) {
      const extracted = await extractBinaryText({
        kind: source.kind,
        mimeType: source.mimeType ?? DEFAULT_MIME_FOR_KIND[source.kind],
        data: bytes,
        workspaceId,
      });
      body = extracted.markdown;
      extractionModelId = extracted.modelId;
      const cents = costFor(extracted.modelId, extracted.usage);
      if (cents > 0) {
        await db
          .insert(SpendLedger)
          .values({ workspaceId, kind: "extract", cents, jobId: null });
      }
    } else {
      // "file" with a mime neither text-native nor parseable (or with the
      // Context.dev key unset): keep the capture (metadata only) rather than
      // marking the source failed.
      body = noExtractionStub(source.mimeType);
    }

    const provenance = {
      ...(extractionModelId ? { extractionModelId } : {}),
      ...(extractedBy ? { extractedBy } : {}),
    };
    const metadata =
      Object.keys(provenance).length > 0
        ? { ...(source.metadata ?? {}), ...provenance }
        : source.metadata;
    const rawMdKey = await writeRawMd(
      workspaceId,
      source,
      body,
      contentHash,
      metadata,
    );

    // Idempotency checkpoint: after this, a retry sees status !== "extracting"
    // and returns early instead of re-extracting.
    await db
      .update(Source)
      .set({
        s3KeyRawMd: rawMdKey,
        contentHash,
        metadata,
        status: compilationHeld ? "held" : "queued",
      })
      .where(eq(Source.id, sourceId));

    if (compilationHeld) return [];

    const [job] = await db
      .insert(CompileJob)
      .values({ workspaceId, sourceId })
      .returning({ id: CompileJob.id });
    if (job) {
      await dispatchCompile({ jobId: job.id, workspaceId, sourceId });
    }
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(Source)
      .set({ status: "failed", error: message })
      .where(eq(Source.id, sourceId));
    throw err;
  }
}
