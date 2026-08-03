import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, asc, eq, inArray } from "@acme/db";
import { db } from "@acme/db/client";
import {
  AccessGrant,
  grantRoleSchema,
  UserProfile,
  WorkspaceGroup,
  WorkspaceGroupMember,
  WorkspaceInvite,
  WorkspaceMember,
} from "@acme/db/schema";

import { assertAdmin } from "../lib/access";
import { assertWithinLimit, EntitlementError } from "../lib/entitlements";
import { workspaceProcedure } from "../trpc";

export const membersRouter = {
  list: workspaceProcedure.query(async ({ ctx, input }) => {
    const access = ctx.access;
    const [members, invites] = await Promise.all([
      db
        .select({
          id: WorkspaceMember.id,
          userId: WorkspaceMember.userId,
          userProfileId: WorkspaceMember.userProfileId,
          role: WorkspaceMember.role,
          name: UserProfile.displayName,
          email: UserProfile.primaryEmail,
          createdAt: WorkspaceMember.createdAt,
        })
        .from(WorkspaceMember)
        .innerJoin(
          UserProfile,
          eq(UserProfile.id, WorkspaceMember.userProfileId),
        )
        .where(eq(WorkspaceMember.workspaceId, input.workspaceId))
        .orderBy(asc(WorkspaceMember.createdAt)),
      access.isAdmin
        ? db
            .select({
              id: WorkspaceInvite.id,
              email: WorkspaceInvite.email,
              role: WorkspaceInvite.role,
              createdAt: WorkspaceInvite.createdAt,
            })
            .from(WorkspaceInvite)
            .where(
              and(
                eq(WorkspaceInvite.workspaceId, input.workspaceId),
                eq(WorkspaceInvite.status, "pending"),
              ),
            )
            .orderBy(asc(WorkspaceInvite.createdAt))
        : Promise.resolve([]),
    ]);
    return { members, invites, viewerIsAdmin: access.isAdmin };
  }),

  invite: workspaceProcedure
    .input(
      z.object({
        email: z.string().email().max(320),
        role: z.enum(["member", "admin"]).default("member"),
        initialGrants: z
          .array(
            z.object({
              folderId: z.string().uuid().nullable(),
              role: grantRoleSchema,
            }),
          )
          .max(10)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const email = input.email.trim().toLowerCase();

      // Caps NEW invites once the workspace is at its member limit. Existing
      // members are grandfathered (the count-vs-limit check only blocks at/over
      // the cap).
      try {
        await assertWithinLimit(input.workspaceId, "members");
      } catch (err) {
        if (err instanceof EntitlementError) {
          throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: err.message,
          });
        }
        throw err;
      }

      const [invite] = await db
        .insert(WorkspaceInvite)
        .values({
          workspaceId: input.workspaceId,
          email,
          role: input.role,
          initialGrants: input.initialGrants ?? null,
          invitedByUserId: ctx.session.user.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!invite) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An invite for this email is already pending",
        });
      }

      const clerkInvitationId = (await ctx.invites?.send(email)) ?? null;
      if (clerkInvitationId) {
        await db
          .update(WorkspaceInvite)
          .set({ clerkInvitationId })
          .where(eq(WorkspaceInvite.id, invite.id));
      }
      return { id: invite.id, email, emailSent: clerkInvitationId !== null };
    }),

  revokeInvite: workspaceProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      await db
        .update(WorkspaceInvite)
        .set({ status: "revoked" })
        .where(
          and(
            eq(WorkspaceInvite.id, input.inviteId),
            eq(WorkspaceInvite.workspaceId, input.workspaceId),
            eq(WorkspaceInvite.status, "pending"),
          ),
        );
    }),

  setRole: workspaceProcedure
    .input(
      z.object({
        memberId: z.string().uuid(),
        role: z.enum(["member", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const [target] = await db
        .select({ id: WorkspaceMember.id, role: WorkspaceMember.role })
        .from(WorkspaceMember)
        .where(
          and(
            eq(WorkspaceMember.id, input.memberId),
            eq(WorkspaceMember.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }
      if (target.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The owner's role cannot be changed",
        });
      }
      await db
        .update(WorkspaceMember)
        .set({ role: input.role })
        .where(eq(WorkspaceMember.id, input.memberId));
    }),

  remove: workspaceProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const [target] = await db
        .select({ userId: WorkspaceMember.userId, role: WorkspaceMember.role })
        .from(WorkspaceMember)
        .where(
          and(
            eq(WorkspaceMember.id, input.memberId),
            eq(WorkspaceMember.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }
      if (target.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot remove the owner",
        });
      }
      // Strip the user's direct grants and group memberships in this
      // workspace, then the member row. Sequential (neon-http: no
      // transactions) — worst partial failure leaves stale grants for a
      // removed member, so grants go first.
      await db
        .delete(AccessGrant)
        .where(
          and(
            eq(AccessGrant.workspaceId, input.workspaceId),
            eq(AccessGrant.principalType, "user"),
            eq(AccessGrant.principalId, target.userId),
          ),
        );
      const groups = await db
        .select({ id: WorkspaceGroup.id })
        .from(WorkspaceGroup)
        .where(eq(WorkspaceGroup.workspaceId, input.workspaceId));
      if (groups.length > 0) {
        await db.delete(WorkspaceGroupMember).where(
          and(
            inArray(
              WorkspaceGroupMember.groupId,
              groups.map((g) => g.id),
            ),
            eq(WorkspaceGroupMember.userId, target.userId),
          ),
        );
      }
      await db
        .delete(WorkspaceMember)
        .where(eq(WorkspaceMember.id, input.memberId));
    }),
} satisfies TRPCRouterRecord;
