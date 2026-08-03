import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact, artifactVisibilitySchema, WikiNode } from "@acme/db/schema";

import type { AccessContext } from "../lib/access";
import { requireAccess, targetFolderReadFilter } from "../lib/access";
import { protectedProcedure, workspaceProcedure } from "../trpc";

// Load an artifact by id and resolve the caller's access in its workspace in one
// step. Both are needed by every id-addressed endpoint, so they resolve once.
async function loadAccessibleArtifact(userId: string, id: string) {
  const [artifact] = await db
    .select()
    .from(Artifact)
    .where(eq(Artifact.id, id))
    .limit(1);
  if (!artifact) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  }
  const access = await requireAccess(userId, artifact.workspaceId);
  return { artifact, access };
}

type ArtifactRow = typeof Artifact.$inferSelect;

// Gate an id-addressed artifact endpoint on the caller's role over the artifact's
// target folder ("" when the folder is null or soft-deleted — root semantics).
async function assertArtifactFolderAccess(
  artifact: ArtifactRow,
  access: AccessContext,
  min: "read" | "manage",
): Promise<void> {
  let targetPath = "";
  if (artifact.targetFolderId) {
    const [folder] = await db
      .select({ path: WikiNode.path })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.id, artifact.targetFolderId),
          eq(WikiNode.workspaceId, artifact.workspaceId),
          isNull(WikiNode.deletedAt),
        ),
      )
      .limit(1);
    targetPath = folder?.path ?? "";
  }
  const ok =
    min === "manage"
      ? access.canManage(targetPath)
      : access.canRead(targetPath);
  if (!ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        min === "manage"
          ? "Manager access over the artifact's folder required"
          : "No read access",
    });
  }
}

export const artifactRouter = {
  // A artifact is visible iff its target space is readable (targetFolderReadFilter,
  // shared with sources.list).
  list: workspaceProcedure.query(async ({ ctx, input }) => {
    const { targetPath, scopeFilter } = targetFolderReadFilter(ctx.access);
    return db
      .select({
        id: Artifact.id,
        title: Artifact.title,
        kind: Artifact.kind,
        status: Artifact.status,
        visibility: Artifact.visibility,
        slug: Artifact.slug,
        error: Artifact.error,
        prompt: Artifact.prompt,
        targetPath,
        createdAt: Artifact.createdAt,
        updatedAt: Artifact.updatedAt,
      })
      .from(Artifact)
      .leftJoin(
        WikiNode,
        and(
          eq(WikiNode.id, Artifact.targetFolderId),
          isNull(WikiNode.deletedAt),
        ),
      )
      .where(and(eq(Artifact.workspaceId, input.workspaceId), scopeFilter))
      .orderBy(desc(Artifact.updatedAt));
  }),

  // Change an artifact's share visibility. The slug never changes — only who the
  // link lets in. Replaces the old publish/unpublish pair.
  setVisibility: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        visibility: artifactVisibilitySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { artifact, access } = await loadAccessibleArtifact(
        ctx.session.user.id,
        input.id,
      );
      await assertArtifactFolderAccess(artifact, access, "manage");
      const { slug } = artifact;
      await db
        .update(Artifact)
        .set({
          visibility: input.visibility,
          slug,
          updatedAt: new Date(),
        })
        .where(eq(Artifact.id, artifact.id));
      return { slug, visibility: input.visibility };
    }),

  // Single-artifact status for polling (e.g. the MCP get_artifact tool).
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { artifact, access } = await loadAccessibleArtifact(
        ctx.session.user.id,
        input.id,
      );
      await assertArtifactFolderAccess(artifact, access, "read");
      return {
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        status: artifact.status,
        ready: artifact.status === "draft" && !!artifact.s3KeyHtml,
        visibility: artifact.visibility,
        slug: artifact.slug,
        error: artifact.error,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { artifact, access } = await loadAccessibleArtifact(
        ctx.session.user.id,
        input.id,
      );
      await assertArtifactFolderAccess(artifact, access, "manage");
      await db.delete(Artifact).where(eq(Artifact.id, artifact.id));
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
