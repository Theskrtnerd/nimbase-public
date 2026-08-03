import { TRPCError } from "@trpc/server";

import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode } from "@acme/db/schema";

/**
 * An anchor folder's id → its path, for access checks.
 *
 * The two "no path" cases are NOT the same and must not collapse together:
 *
 *  - `folderId === null` — the row is deliberately anchored at the workspace
 *    root. Returns `""`, which is correct: every access check treats `""` as
 *    root.
 *  - the folder row is missing, soft-deleted, or belongs to another workspace —
 *    returns `null`, and the caller must deny.
 *
 * Collapsing the second case to `""` is a privilege *escalation*, not a
 * fallback: `""` is the widest possible prefix (`prefixCovers("", x)` is always
 * true), so deleting a restricted folder would silently promote everything
 * anchored to it to workspace-root visibility. Several call sites used to do
 * `folder?.path ?? ""`; this is the one implementation they all share now.
 *
 * Matches `resolveTargetFolderPath` in apps/nextjs/src/server/folders.ts, which
 * the REST routes and MCP tools use.
 */
export async function anchorFolderPath(
  workspaceId: string,
  folderId: string | null,
): Promise<string | null> {
  if (!folderId) return "";
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
  return folder ? folder.path : null;
}

// Normalize a user-supplied folder path: no leading/trailing slashes, no
// blank segments. Throws on effectively-empty input.
export function normalizeFolderPath(path: string): string {
  const clean = path
    .split("/")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .join("/");
  if (!clean) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Folder path required",
    });
  }
  return clean;
}

// Find-or-create the WikiNode row anchoring grants/restricted flags to a
// folder. Folders are implicit path prefixes elsewhere; permissions need a
// real row so grants survive renames (node-keyed, not path-keyed).
export async function ensureFolderNode(
  workspaceId: string,
  path: string,
): Promise<{ id: string; restricted: boolean }> {
  const clean = normalizeFolderPath(path);
  const [existing] = await db
    .select({
      id: WikiNode.id,
      kind: WikiNode.kind,
      restricted: WikiNode.restricted,
    })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.workspaceId, workspaceId),
        eq(WikiNode.path, clean),
        isNull(WikiNode.deletedAt),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.kind === "note" || existing.kind === "dataset") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Grants attach to folders, not notes/datasets",
      });
    }
    return { id: existing.id, restricted: existing.restricted };
  }
  // wiki_node_workspace_path_idx (unique on live paths) makes the insert
  // race-safe: a concurrent creator wins the index and we re-read their row.
  // title is NOT NULL table-wide but never displayed for folder rows — the
  // last path segment is just a throwaway placeholder to satisfy the column.
  const [created] = await db
    .insert(WikiNode)
    .values({
      workspaceId,
      path: clean,
      kind: "folder",
      title: clean.split("/").pop() ?? clean,
    })
    .onConflictDoNothing()
    .returning({ id: WikiNode.id, restricted: WikiNode.restricted });
  if (created) return created;
  const [raced] = await db
    .select({ id: WikiNode.id, restricted: WikiNode.restricted })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.workspaceId, workspaceId),
        eq(WikiNode.path, clean),
        isNull(WikiNode.deletedAt),
      ),
    )
    .limit(1);
  if (!raced) throw new Error("failed to insert folder node");
  return raced;
}
