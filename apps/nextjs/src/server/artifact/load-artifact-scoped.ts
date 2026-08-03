import "server-only";

import { and, eq, isNull, or } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact, WikiNode } from "@acme/db/schema";

import { isUuidParam } from "~/server/http/params";

type ArtifactRow = typeof Artifact.$inferSelect;

/**
 * Load an artifact by slug (or legacy UUID) within a workspace and resolve its
 * target folder path (""=root). Path-based so callers can gate on an
 * AccessContext from either the session-token or ApiToken auth path (unlike the
 * user-id-based loadAccessibleArtifact in the tRPC router).
 */
export async function loadArtifactScoped(
  artifactRef: string,
  workspaceId: string,
): Promise<{ artifact: ArtifactRow; targetPath: string } | null> {
  const [artifact] = await db
    .select()
    .from(Artifact)
    .where(
      and(
        isUuidParam(artifactRef)
          ? or(eq(Artifact.id, artifactRef), eq(Artifact.slug, artifactRef))
          : eq(Artifact.slug, artifactRef),
        eq(Artifact.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!artifact) return null;

  let targetPath = "";
  if (artifact.targetFolderId) {
    const [folder] = await db
      .select({ path: WikiNode.path })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.id, artifact.targetFolderId),
          eq(WikiNode.workspaceId, workspaceId),
          isNull(WikiNode.deletedAt),
        ),
      )
      .limit(1);
    targetPath = folder?.path ?? "";
  }
  return { artifact, targetPath };
}
