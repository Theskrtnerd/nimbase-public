// Drain every pending workspace after the additive schema migration or as an
// operational repair command. Normal writes dispatch their own projection;
// this is the durable-journal recovery path when no later write arrives.
import { isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { MemoryMutation } from "@acme/db/schema";

import { projectPendingMemoryHistory } from "../memory/git-history";

async function main(): Promise<void> {
  const workspaces = await db
    .selectDistinct({ workspaceId: MemoryMutation.workspaceId })
    .from(MemoryMutation)
    .where(isNull(MemoryMutation.projectedAt));
  const counts = await Promise.all(
    workspaces.map(({ workspaceId }) =>
      projectPendingMemoryHistory(workspaceId),
    ),
  );
  const projected = counts.reduce((total, count) => total + count, 0);
  console.info(
    `Projected ${String(projected)} mutation(s) across ${String(workspaces.length)} workspace(s).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
