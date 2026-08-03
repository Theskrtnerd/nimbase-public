import "server-only";

import type { BrainInitJobData } from "@acme/cloud";
import { publishBrainInit } from "@acme/cloud";

import { env } from "~/env";
import { runBrainInitJob } from "./init";

// Prod (QSTASH_TOKEN set): hand off to QStash, return immediately.
// Local dev (unset): run the job inline so no tunnel/worker is needed.
export async function dispatchBrainInit(data: BrainInitJobData): Promise<void> {
  if (env.QSTASH_TOKEN) {
    await publishBrainInit(data);
    return;
  }
  // Dev-inline: run in the background so workspace.create returns immediately —
  // the job's own try/catch stamps brainInitStatus, and the Home card polls it.
  // (Unlike compile/artifact inline dispatch, this sits inside an interactive
  // onboarding mutation; blocking ~30s on the draft is unacceptable UX.)
  void runBrainInitJob(data).catch((err) => {
    console.error("[brain-init] inline job failed", err);
  });
}
