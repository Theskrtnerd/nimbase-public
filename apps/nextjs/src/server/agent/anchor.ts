import "server-only";

import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode } from "@acme/db/schema";

/**
 * An agent anchor folder's path. A null folderId is the workspace root ("");
 * a folderId that resolves to nothing returns null and the caller must deny.
 *
 * Previously this fell back to "" for a missing/soft-deleted folder, which is
 * backwards: "" is the widest prefix, so deleting a restricted anchor folder
 * promoted the agent to reading the whole workspace. It also queried by id
 * alone, without scoping to the workspace.
 *
 * The access check (read vs manage) still lives at each call site.
 */
export async function agentAnchorPath(
  workspaceId: string,
  targetFolderId: string | null,
): Promise<string | null> {
  if (!targetFolderId) return "";
  const [folder] = await db
    .select({ path: WikiNode.path })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.id, targetFolderId),
        eq(WikiNode.workspaceId, workspaceId),
        isNull(WikiNode.deletedAt),
      ),
    )
    .limit(1);
  return folder ? folder.path : null;
}
