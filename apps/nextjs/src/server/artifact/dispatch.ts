import "server-only";

import type { ArtifactGenerateJobData } from "@acme/runtime/queue";
import { publishArtifactGenerate } from "@acme/runtime/queue";

import { env } from "~/env";
import { processArtifactGenerateJob } from "./generate";

// Prod (QSTASH_TOKEN set): hand off to QStash, return immediately.
// Local dev (unset): run the generation inline so no tunnel/worker is needed.
export async function dispatchArtifactGenerate(
  data: ArtifactGenerateJobData,
): Promise<void> {
  if (env.QSTASH_TOKEN) {
    await publishArtifactGenerate(data);
    return;
  }
  // Inline (dev): a failure already marks the artifact "failed" inside
  // processArtifactGenerateJob. Swallow the re-thrown error so it doesn't
  // bubble up and 500 the triggering request — this mirrors prod, where a
  // QStash job failing never fails the enqueue.
  try {
    await processArtifactGenerateJob(data);
  } catch (err) {
    console.error("[artifact] inline job failed (artifact marked failed)", err);
  }
}
