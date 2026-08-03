import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { headObject, presignGetUrl, presignPutUrl } from "@acme/cloud/s3";
import { and, count, desc, eq, getTableColumns } from "@acme/db";
import { db } from "@acme/db/client";
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  Workspace,
  WorkspaceMember,
} from "@acme/db/schema";

import { assertAdmin, requireAccess } from "../lib/access";
import { createWorkspace } from "../lib/workspace-control";
import { protectedProcedure, workspaceProcedure } from "../trpc";

type WorkspaceRecord = typeof Workspace.$inferSelect;

export const workspaceRouter = {
  all: protectedProcedure.query(async ({ ctx }): Promise<WorkspaceRecord[]> => {
    return await db
      .select(getTableColumns(Workspace))
      .from(Workspace)
      .innerJoin(
        WorkspaceMember,
        and(
          eq(WorkspaceMember.workspaceId, Workspace.id),
          eq(WorkspaceMember.userId, ctx.session.user.id),
        ),
      )
      .orderBy(desc(Workspace.createdAt));
  }),

  // Branding objects stay private in S3. Return short-lived URLs only for
  // workspaces the caller belongs to; a missing or unavailable object degrades
  // to null so the activity bar can keep showing its monogram fallback.
  logoUrls: protectedProcedure.query(async ({ ctx }) => {
    const workspaces = await db
      .select({ id: Workspace.id })
      .from(Workspace)
      .innerJoin(
        WorkspaceMember,
        and(
          eq(WorkspaceMember.workspaceId, Workspace.id),
          eq(WorkspaceMember.userId, ctx.session.user.id),
        ),
      );

    return Object.fromEntries(
      await Promise.all(
        workspaces.map(async ({ id }) => {
          const key = `workspaces/${id}/branding/logo`;
          try {
            return [
              id,
              (await headObject(key)) ? await presignGetUrl(key) : null,
            ];
          } catch {
            return [id, null];
          }
        }),
      ),
    ) as Record<string, string | null>;
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<WorkspaceRecord | undefined> => {
      const [row] = await db
        .select(getTableColumns(Workspace))
        .from(Workspace)
        .innerJoin(
          WorkspaceMember,
          and(
            eq(WorkspaceMember.workspaceId, Workspace.id),
            eq(WorkspaceMember.userId, ctx.session.user.id),
          ),
        )
        .where(eq(Workspace.id, input.id))
        .limit(1);
      return row;
    }),

  create: protectedProcedure.input(CreateWorkspaceSchema).mutation(
    async ({ ctx, input }): Promise<WorkspaceRecord> =>
      createWorkspace({
        input,
        creator: ctx.session.user,
        brainInit: ctx.brainInit,
        identitySources: { title: "manual", description: "manual" },
      }),
  ),

  // Presign an S3 PUT for the workspace logo (optional onboarding step).
  // Fixed key per workspace — re-uploading replaces the logo.
  logoUploadUrl: workspaceProcedure
    .input(
      z.object({
        contentType: z.enum([
          "image/png",
          "image/jpeg",
          "image/svg+xml",
          "image/webp",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const key = `workspaces/${ctx.access.workspaceId}/branding/logo`;
      const url = await presignPutUrl(key, input.contentType);
      return { url, key };
    }),

  // Brain initialization: the Biographer drafts company.md — the root note of
  // the memory — from the workspace identity (name, description, website).
  // Enqueued server-side from `create` (NOT-94); this endpoint is the admin
  // retry — resets status to "pending" and re-enqueues against the port.
  initializeBrain: workspaceProcedure.mutation(async ({ ctx }) => {
    assertAdmin(ctx.access);
    const workspaceId = ctx.access.workspaceId;
    const [workspace] = await db
      .select({ id: Workspace.id, website: Workspace.website })
      .from(Workspace)
      .where(eq(Workspace.id, workspaceId))
      .limit(1);
    if (!workspace) throw new TRPCError({ code: "NOT_FOUND" });
    if (!ctx.brainInit) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Brain init unavailable",
      });
    }
    await db
      .update(Workspace)
      .set({ brainInitStatus: "pending" })
      .where(eq(Workspace.id, workspaceId));
    await ctx.brainInit.enqueue({
      workspaceId,
      websiteUrl: workspace.website,
      identitySources: { title: "manual", description: "manual" },
    });
    return { enqueued: true };
  }),

  // Status of the day-zero Biographer draft, polled by the onboarding client
  // and any admin retry affordance.
  brainInit: workspaceProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({ status: Workspace.brainInitStatus })
      .from(Workspace)
      .where(eq(Workspace.id, ctx.access.workspaceId))
      .limit(1);
    return { status: row?.status ?? "pending" };
  }),

  update: protectedProcedure
    .input(UpdateWorkspaceSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceRecord> => {
      const access = await requireAccess(ctx.session.user.id, input.id);
      assertAdmin(access);

      const [workspace] = await db
        .update(Workspace)
        .set({
          name: input.name,
          ...(input.description !== undefined
            ? {
                description: input.description.length
                  ? input.description
                  : null,
              }
            : {}),
        })
        .where(eq(Workspace.id, input.id))
        .returning();

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      return workspace;
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        confirmationName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ remaining: number }> => {
      const access = await requireAccess(ctx.session.user.id, input.id);
      if (access.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can delete a workspace",
        });
      }

      const [workspace] = await db
        .select({ name: Workspace.name })
        .from(Workspace)
        .where(eq(Workspace.id, input.id))
        .limit(1);
      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }
      if (input.confirmationName !== workspace.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter the workspace name exactly to confirm deletion",
        });
      }

      await db.delete(Workspace).where(eq(Workspace.id, input.id));

      const [row] = await db
        .select({ count: count() })
        .from(Workspace)
        .innerJoin(
          WorkspaceMember,
          and(
            eq(WorkspaceMember.workspaceId, Workspace.id),
            eq(WorkspaceMember.userId, ctx.session.user.id),
          ),
        );

      return { remaining: row?.count ?? 0 };
    }),
} satisfies TRPCRouterRecord;
