import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode } from "@acme/db/schema";

// Resolving a capture/artifact target folder, fenced to the workspace and to live
// folder rows. Two inverse lookups: the REST routes carry a folder id and need
// its path (for the canCapture gate); the MCP tools carry a human path and need
// its id (to anchor the source). One place for the "what is a valid target
// folder" rule so the ingest/presign/artifact routes and MCP tools can't drift.

// By id → path. null id = workspace root (""). null result = no such live
// folder in this workspace (caller decides the not-found response).
export async function resolveTargetFolderPath(
  workspaceId: string,
  targetFolderId: string | null,
): Promise<{ path: string } | null> {
  if (!targetFolderId) return { path: "" };
  const [folder] = await db
    .select({ path: WikiNode.path })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.id, targetFolderId),
        eq(WikiNode.workspaceId, workspaceId),
        eq(WikiNode.kind, "folder"),
        isNull(WikiNode.deletedAt),
      ),
    )
    .limit(1);
  return folder ? { path: folder.path } : null;
}

// By path → id. Empty/omitted path = workspace root ({ id: null, path: "" }).
// null result = no such live folder (caller decides the not-found response).
export async function resolveFolderByPath(
  workspaceId: string,
  targetPath: string | null | undefined,
): Promise<{ id: string | null; path: string } | null> {
  if (!targetPath) return { id: null, path: "" };
  const [folder] = await db
    .select({ id: WikiNode.id, path: WikiNode.path })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.workspaceId, workspaceId),
        eq(WikiNode.path, targetPath),
        eq(WikiNode.kind, "folder"),
        isNull(WikiNode.deletedAt),
      ),
    )
    .limit(1);
  return folder ? { id: folder.id, path: folder.path } : null;
}
