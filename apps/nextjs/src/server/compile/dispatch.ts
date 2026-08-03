import "server-only";

import type { CompileJobData } from "@acme/cloud";
import { publishCompile } from "@acme/cloud";

import { env } from "~/env";
import { processCompileJob } from "./process";

// Prod (QSTASH_TOKEN set): hand off to QStash, return immediately.
// Local dev (unset): run the job inline so no tunnel/worker is needed.
export async function dispatchCompile(data: CompileJobData): Promise<void> {
  if (env.QSTASH_TOKEN) {
    await publishCompile(data);
    return;
  }
  // Inline (dev): a compile failure already marks the source/job "failed"
  // inside runCompileJob. Swallow the re-thrown error here so it doesn't
  // bubble up and 500 the triggering request (ingest/artifact) — this mirrors
  // prod, where a QStash job failing never fails the enqueue.
  try {
    await runCompileJob(data);
  } catch (err) {
    console.error("[compile] inline job failed (source marked failed)", err);
  }
}

export async function runCompileJob(data: CompileJobData): Promise<void> {
  await processCompileJob(data);
}
