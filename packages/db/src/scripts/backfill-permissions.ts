// One-off backfill for the permissions migration:
//   pnpm -F @acme/db backfill:permissions
// Requires POSTGRES_URL in the environment (same as db:push).
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "../client";
import {
  AccessGrant,
  ExternalIdentity,
  UserProfile,
  Workspace,
  WorkspaceMember,
} from "../schema";

async function main() {
  const workspaces = await db
    .select({ id: Workspace.id, ownerUserId: Workspace.ownerUserId })
    .from(Workspace);
  console.log(`backfilling ${workspaces.length} workspaces`);

  for (const ws of workspaces) {
    const userProfileId = randomUUID();
    await db
      .insert(UserProfile)
      .values({ id: userProfileId, workspaceId: ws.id })
      .onConflictDoNothing();
    await db
      .insert(ExternalIdentity)
      .values({
        workspaceId: ws.id,
        userProfileId,
        provider: "clerk",
        tenantId: "nimbase",
        subject: ws.ownerUserId,
      })
      .onConflictDoNothing();
    await db
      .insert(WorkspaceMember)
      .values({
        workspaceId: ws.id,
        userId: ws.ownerUserId,
        userProfileId,
        role: "owner",
      })
      .onConflictDoNothing();
    const existing = await db
      .select({ id: AccessGrant.id })
      .from(AccessGrant)
      .where(eq(AccessGrant.workspaceId, ws.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(AccessGrant).values({
        workspaceId: ws.id,
        principalType: "all_members",
        role: "contributor",
      });
    }
  }
  console.log("done");
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
