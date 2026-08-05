import "server-only";

import { publishMemoryGitProjection } from "../queue";
import { projectPendingMemoryHistory } from "./git-history";

// Projection is intentionally downstream of the durable mutation journal.
// A queue or object-store outage is observable and retryable, but never rolls
// back memory that Postgres and the OKF object store have already accepted.
export async function notifyMemoryGitProjection(input: {
  mutationId: string;
  workspaceId: string;
}): Promise<void> {
  if (process.env.QSTASH_TOKEN) {
    try {
      await publishMemoryGitProjection({
        jobId: input.mutationId,
        workspaceId: input.workspaceId,
      });
      return;
    } catch (error) {
      console.error(
        "[memory-git] queue dispatch failed; trying inline projection",
        error,
      );
    }
  }
  try {
    await projectPendingMemoryHistory(input.workspaceId);
  } catch (error) {
    console.error(
      "[memory-git] projection dispatch failed; mutation remains pending",
      error,
    );
  }
}
