import "server-only";

import type { ExtractJobData } from "@acme/cloud";
import { publishExtract } from "@acme/cloud";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Source } from "@acme/db/schema";

import { env } from "~/env";
import { processExtractJob } from "./extract";

// Prod (QSTASH_TOKEN set): hand off to QStash, return immediately.
// Local dev (unset): run the extraction inline so no tunnel/worker is needed.
export async function dispatchExtract(data: ExtractJobData): Promise<void> {
  if (env.QSTASH_TOKEN) {
    await publishExtract(data);
    return;
  }
  // Inline (dev): an extract failure already marks the source "failed" inside
  // processExtractJob. Swallow the re-thrown error here so it doesn't bubble
  // up and 500 the triggering request (finalize) — mirrors dispatchCompile.
  try {
    await runExtractJob(data);
  } catch (err) {
    console.error("[extract] inline job failed (source marked failed)", err);
  }
}

/**
 * The tail after every extract, shared by the QStash handler and dev-inline:
 * run the job, then dispatch the extract jobs for any children an archive
 * expanded into (empty for every other source kind).
 *
 * A child whose enqueue throws is marked failed and skipped rather than failing
 * the whole archive — the container is already marked compiled, and one child
 * that never starts must not strand the rest.
 */
export async function runExtractJob(data: ExtractJobData): Promise<void> {
  const childJobs = await processExtractJob(data);
  for (const job of childJobs) {
    try {
      await dispatchExtract(job);
    } catch (err) {
      console.error(
        "[extract] archive child enqueue failed",
        job.sourceId,
        err,
      );
      // expandZipSource already inserted the child as "extracting". Without
      // this the row keeps that status forever with no queue message behind
      // it: the Sources view polls it as perpetually compiling and no retry
      // can pick it up, because re-eligibility is keyed on status.
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(Source)
        .set({ status: "failed", error: `enqueue failed: ${message}` })
        .where(eq(Source.id, job.sourceId));
    }
  }
}
