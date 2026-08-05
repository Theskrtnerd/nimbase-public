import "server-only";

import type { PathScope } from "@acme/api/access-core";
import type {
  ReconcileCandidate,
  ResolvedAccessLike,
} from "@acme/runtime/memory";
import type { CompileJobData } from "@acme/runtime/queue";
import { prefixCovers } from "@acme/api/access-core";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { CompileJob, Source, SpendLedger, WikiNode } from "@acme/db/schema";
import { costFor, resolveModels } from "@acme/runtime/ai";
import { toProviderContext } from "@acme/runtime/memory";
import { GardenerError } from "@acme/runtime/memory/wiki";
import { memoryProvider } from "@acme/runtime/memory/wiki-pg-provider";
import * as s3 from "@acme/runtime/s3";

// The compile pipeline drives its writes through the shared MemoryProvider seam
// (`memoryProvider.reconcile`) rather than the gardener directly, so the backend
// stays swappable behind the contract. See docs/architecture/memory-kernel.md.

// Runs one canonical compile into the source's authorized target folder.
export async function processCompileJob(data: CompileJobData): Promise<void> {
  const { workspaceId, sourceId, jobId } = data;

  const outcome = sourceOutcome(sourceId);

  await db
    .update(CompileJob)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(CompileJob.id, jobId));

  try {
    const [source] = await db
      .select()
      .from(Source)
      .where(eq(Source.id, sourceId))
      .limit(1);
    if (!source) throw new Error(`source ${sourceId} not found`);

    if (source.status === "held" || source.accessPolicyId != null) {
      await Promise.all([
        db
          .update(Source)
          .set({ status: "held", error: null })
          .where(eq(Source.id, sourceId)),
        db
          .update(CompileJob)
          .set({
            status: "failed",
            error: "provider access policy blocks compilation",
            finishedAt: new Date(),
          })
          .where(eq(CompileJob.id, jobId)),
      ]);
      return;
    }

    // Ingest (text kinds) or the extract job (screenshot/voice/file) always
    // produces raw.md before a CompileJob is ever created; the fallback to
    // the original only covers pre-migration rows that never got one.
    // Fence: the capture's target subtree minus restricted boundaries inside
    // it. Capturer rights were verified at ingest; this keeps the compiler
    // from wandering regardless.
    // The object key comes from this workspace-bound Source row, never from the
    // compile request, so callers cannot select another tenant's S3 prefix.
    const rawObjectKey = source.s3KeyRawMd ?? source.s3KeyOriginal;
    const [rawText, targetPath, restrictedRows] = await Promise.all([
      s3.getObjectText(rawObjectKey),
      resolveCanonicalTarget(workspaceId, source.targetFolderId),
      db
        .select({ path: WikiNode.path })
        .from(WikiNode)
        .where(
          and(
            eq(WikiNode.workspaceId, workspaceId),
            eq(WikiNode.restricted, true),
            isNull(WikiNode.deletedAt),
          ),
        ),
    ]);
    const fence: PathScope = {
      prefix: targetPath,
      exclude: restrictedRows.flatMap((row) =>
        prefixCovers(targetPath, row.path) &&
        !prefixCovers(row.path, targetPath)
          ? [row.path]
          : [],
      ),
    };

    // Agentic compile through the provider's reconcile front door: the
    // gardener (the wiki backend's reconcile strategy) explores the existing
    // wiki through the virtual filesystem and merges/creates/reorganizes notes,
    // fenced to `fence`. All writes flow through the append-only version
    // machinery, so a QStash retry resumes from real wiki state, not a stale
    // plan. The compile worker is a trusted system actor: its provider context
    // is unrestricted (scopes → null), and the VFS `fence` — derived from the
    // capturer's verified target folder — is the real write boundary.
    const systemAccess: ResolvedAccessLike = {
      workspaceId,
      userId: null,
      scopes: () => null,
    };
    const ctx = toProviderContext(systemAccess);
    const candidate: ReconcileCandidate = {
      sourceKind: source.kind,
      title: source.title ?? undefined,
      content: rawText,
    };
    const { chat } = await resolveModels(workspaceId);
    const result = await memoryProvider.reconcile(ctx, candidate, {
      sourceId,
      jobId,
      fence,
    });
    const { report, usage } = result;

    // Per-job reconcile outcome — the typed record of what the compile did to
    // the wiki (insert/merge/supersede/noop), distinct from the prose report.
    console.info(
      `[compile] reconcile ${result.action}` +
        (result.nodeId ? ` node=${result.nodeId}` : "") +
        (result.supersededIds?.length
          ? ` superseded=${result.supersededIds.join(",")}`
          : "") +
        (result.deletedIds?.length
          ? ` deleted=${result.deletedIds.join(",")}`
          : ""),
      { jobId, sourceId },
    );

    // Cost/SpendLedger uses this job's own model resolution (deterministic —
    // the provider resolves the same per-workspace config independently).
    const cents = costFor(chat.id, usage);

    await outcome.compiled(report);
    await db
      .update(CompileJob)
      .set({
        status: "done",
        finishedAt: new Date(),
        tokenUsage: {
          input: usage.inputTokens,
          output: usage.outputTokens,
          costCents: cents,
        },
      })
      .where(eq(CompileJob.id, jobId));
    await db.insert(SpendLedger).values({
      workspaceId,
      kind: "compile",
      cents,
      jobId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const partialReport =
      err instanceof GardenerError ? err.partialReport : null;
    await outcome.failed(message, partialReport);
    await db
      .update(CompileJob)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(CompileJob.id, jobId));
    throw err;
  }
}

interface CompileOutcome {
  compiled: (report: string) => Promise<void>;
  failed: (message: string, partialReport: string | null) => Promise<void>;
}

function sourceOutcome(sourceId: string): CompileOutcome {
  return {
    compiled: async (report) => {
      await db
        .update(Source)
        .set({
          status: "compiled",
          compiledAt: new Date(),
          compileReport: report,
        })
        .where(eq(Source.id, sourceId));
    },
    failed: async (message, partialReport) => {
      await db
        .update(Source)
        .set({
          status: "failed",
          error: message,
          ...(partialReport ? { compileReport: partialReport } : {}),
        })
        .where(eq(Source.id, sourceId));
    },
  };
}

async function resolveCanonicalTarget(
  workspaceId: string,
  targetFolderId: string | null,
): Promise<string> {
  if (!targetFolderId) return "";
  const targetPath = await resolveLiveFolderPath(workspaceId, targetFolderId);
  if (targetPath === null) {
    throw new Error(`target folder ${targetFolderId} no longer exists`);
  }
  return targetPath;
}

async function resolveLiveFolderPath(
  workspaceId: string,
  folderId: string,
): Promise<string | null> {
  const [folder] = await db
    .select({ path: WikiNode.path })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.id, folderId),
        eq(WikiNode.workspaceId, workspaceId),
        isNull(WikiNode.deletedAt),
      ),
    )
    .limit(1);
  return folder?.path ?? null;
}
