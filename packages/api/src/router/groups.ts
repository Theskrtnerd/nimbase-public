import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, asc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  AccessGrant,
  WorkspaceGroup,
  WorkspaceGroupMember,
  WorkspaceMember,
} from "@acme/db/schema";

import { assertAdmin } from "../lib/access";
import { workspaceProcedure } from "../trpc";

export const groupsRouter = {
  // workspaceProcedure already gates on membership; no body check needed.
  list: workspaceProcedure.query(async ({ input }) => {
    const [groups, memberships] = await Promise.all([
      db
        .select({ id: WorkspaceGroup.id, name: WorkspaceGroup.name })
        .from(WorkspaceGroup)
        .where(eq(WorkspaceGroup.workspaceId, input.workspaceId))
        .orderBy(asc(WorkspaceGroup.name)),
      db
        .select({
          groupId: WorkspaceGroupMember.groupId,
          userId: WorkspaceGroupMember.userId,
          name: WorkspaceMember.name,
          email: WorkspaceMember.email,
        })
        .from(WorkspaceGroupMember)
        .innerJoin(
          WorkspaceGroup,
          eq(WorkspaceGroup.id, WorkspaceGroupMember.groupId),
        )
        .leftJoin(
          WorkspaceMember,
          and(
            eq(WorkspaceMember.workspaceId, WorkspaceGroup.workspaceId),
            eq(WorkspaceMember.userId, WorkspaceGroupMember.userId),
          ),
        )
        .where(eq(WorkspaceGroup.workspaceId, input.workspaceId)),
    ]);
    return groups.map((group) => ({
      ...group,
      members: memberships.filter((m) => m.groupId === group.id),
    }));
  }),

  create: workspaceProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const [group] = await db
        .insert(WorkspaceGroup)
        .values({ workspaceId: input.workspaceId, name: input.name })
        .onConflictDoNothing()
        .returning();
      if (!group) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Group name already exists",
        });
      }
      return group;
    }),

  delete: workspaceProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      // Grants pointing at the group die with it (no orphan principals).
      await db
        .delete(AccessGrant)
        .where(
          and(
            eq(AccessGrant.workspaceId, input.workspaceId),
            eq(AccessGrant.principalType, "group"),
            eq(AccessGrant.principalId, input.groupId),
          ),
        );
      await db
        .delete(WorkspaceGroup)
        .where(
          and(
            eq(WorkspaceGroup.id, input.groupId),
            eq(WorkspaceGroup.workspaceId, input.workspaceId),
          ),
        );
    }),

  addMember: workspaceProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const [member, group] = await Promise.all([
        db
          .select({ id: WorkspaceMember.id })
          .from(WorkspaceMember)
          .where(
            and(
              eq(WorkspaceMember.workspaceId, input.workspaceId),
              eq(WorkspaceMember.userId, input.userId),
            ),
          )
          .limit(1),
        db
          .select({ id: WorkspaceGroup.id })
          .from(WorkspaceGroup)
          .where(
            and(
              eq(WorkspaceGroup.id, input.groupId),
              eq(WorkspaceGroup.workspaceId, input.workspaceId),
            ),
          )
          .limit(1),
      ]);
      if (member.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a workspace member",
        });
      }
      if (group.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }
      await db
        .insert(WorkspaceGroupMember)
        .values({ groupId: input.groupId, userId: input.userId })
        .onConflictDoNothing();
    }),

  removeMember: workspaceProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const [group] = await db
        .select({ id: WorkspaceGroup.id })
        .from(WorkspaceGroup)
        .where(
          and(
            eq(WorkspaceGroup.id, input.groupId),
            eq(WorkspaceGroup.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }
      await db
        .delete(WorkspaceGroupMember)
        .where(
          and(
            eq(WorkspaceGroupMember.groupId, input.groupId),
            eq(WorkspaceGroupMember.userId, input.userId),
          ),
        );
    }),
} satisfies TRPCRouterRecord;
