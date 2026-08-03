import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, inArray, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import {
  AccessGrant,
  grantRoleSchema,
  WikiNode,
  WorkspaceGroup,
  WorkspaceMember,
} from "@acme/db/schema";

import { assertAdmin } from "../lib/access";
import { listCaptureTargets } from "../lib/capture-targets";
import { ensureFolderNode, normalizeFolderPath } from "../lib/folders";
import { workspaceProcedure } from "../trpc";

const grantUpsertTarget = [
  AccessGrant.workspaceId,
  AccessGrant.principalType,
  AccessGrant.principalId,
  AccessGrant.folderId,
];

export const accessRouter = {
  // Grants attached to one folder (or root when path === "").
  listFolderAccess: workspaceProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = ctx.access;
      const path = input.path === "" ? "" : normalizeFolderPath(input.path);
      if (!access.canRead(path) && !access.canManage(path)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
      }

      let folderId: string | null = null;
      let restricted = false;
      if (path !== "") {
        const [folder] = await db
          .select({ id: WikiNode.id, restricted: WikiNode.restricted })
          .from(WikiNode)
          .where(
            and(
              eq(WikiNode.workspaceId, input.workspaceId),
              eq(WikiNode.path, path),
              isNull(WikiNode.deletedAt),
            ),
          )
          .limit(1);
        if (!folder) {
          // Implicit folder with no anchor row yet — nothing attached.
          return {
            grants: [],
            restricted: false,
            canManage: access.canManage(path),
          };
        }
        folderId = folder.id;
        restricted = folder.restricted;
      }

      const grants = await db
        .select({
          id: AccessGrant.id,
          principalType: AccessGrant.principalType,
          principalId: AccessGrant.principalId,
          role: AccessGrant.role,
        })
        .from(AccessGrant)
        .where(
          and(
            eq(AccessGrant.workspaceId, input.workspaceId),
            folderId === null
              ? isNull(AccessGrant.folderId)
              : eq(AccessGrant.folderId, folderId),
          ),
        );

      // Agent principals are internal and do not belong in this human-grant
      // response. Filtering also narrows the type back to the human principal
      // union.
      type HumanGrant = (typeof grants)[number] & {
        principalType: "user" | "group" | "all_members";
      };
      const visibleGrants = grants.filter(
        (g): g is HumanGrant => g.principalType !== "agent",
      );

      const userIds = visibleGrants.flatMap((g) =>
        g.principalType === "user" && g.principalId !== null
          ? [g.principalId]
          : [],
      );
      const groupIds = visibleGrants.flatMap((g) =>
        g.principalType === "group" && g.principalId !== null
          ? [g.principalId]
          : [],
      );
      const [users, groups] = await Promise.all([
        userIds.length > 0
          ? db
              .select({
                userId: WorkspaceMember.userId,
                name: WorkspaceMember.name,
                email: WorkspaceMember.email,
              })
              .from(WorkspaceMember)
              .where(
                and(
                  eq(WorkspaceMember.workspaceId, input.workspaceId),
                  inArray(WorkspaceMember.userId, userIds),
                ),
              )
          : Promise.resolve([]),
        groupIds.length > 0
          ? db
              .select({ id: WorkspaceGroup.id, name: WorkspaceGroup.name })
              .from(WorkspaceGroup)
              .where(inArray(WorkspaceGroup.id, groupIds))
          : Promise.resolve([]),
      ]);

      return {
        restricted,
        canManage: access.canManage(path),
        grants: visibleGrants.map((g) => {
          const user =
            g.principalType === "user"
              ? users.find((u) => u.userId === g.principalId)
              : undefined;
          const group =
            g.principalType === "group"
              ? groups.find((gr) => gr.id === g.principalId)
              : undefined;
          return {
            ...g,
            label:
              g.principalType === "all_members"
                ? "Everyone in workspace"
                : g.principalType === "user"
                  ? (user?.name ??
                    user?.email ??
                    g.principalId ??
                    "Unknown user")
                  : (group?.name ?? "Unknown group"),
          };
        }),
      };
    }),

  upsertGrant: workspaceProcedure
    .input(
      z.object({
        path: z.string(), // "" = root (admin only)
        principalType: z.enum(["user", "group", "all_members"]),
        principalId: z.string().nullable(),
        role: grantRoleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = ctx.access;
      const path = input.path === "" ? "" : normalizeFolderPath(input.path);
      if (path === "") {
        assertAdmin(access);
      } else if (!access.canManage(path)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Manager access required",
        });
      }
      if (input.principalType !== "all_members" && input.principalId === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "principalId required",
        });
      }
      const folderId =
        path === ""
          ? null
          : (await ensureFolderNode(input.workspaceId, path)).id;
      await db
        .insert(AccessGrant)
        .values({
          workspaceId: input.workspaceId,
          principalType: input.principalType,
          principalId:
            input.principalType === "all_members" ? null : input.principalId,
          folderId,
          role: input.role,
          createdByUserId: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: grantUpsertTarget,
          set: { role: input.role },
        });
    }),

  removeGrant: workspaceProcedure
    .input(z.object({ grantId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const access = ctx.access;
      const [grant] = await db
        .select({ id: AccessGrant.id, folderPath: WikiNode.path })
        .from(AccessGrant)
        .leftJoin(WikiNode, eq(WikiNode.id, AccessGrant.folderId))
        .where(
          and(
            eq(AccessGrant.id, input.grantId),
            eq(AccessGrant.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!grant) return;
      const path = grant.folderPath ?? "";
      if (path === "") {
        assertAdmin(access);
      } else if (!access.canManage(path)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Manager access required",
        });
      }
      await db.delete(AccessGrant).where(eq(AccessGrant.id, input.grantId));
    }),

  setRestricted: workspaceProcedure
    .input(
      z.object({
        path: z.string().min(1),
        restricted: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = ctx.access;
      const path = normalizeFolderPath(input.path);
      if (!access.canManage(path)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Manager access required",
        });
      }
      const folder = await ensureFolderNode(input.workspaceId, path);
      await db
        .update(WikiNode)
        .set({ restricted: input.restricted })
        .where(eq(WikiNode.id, folder.id));
      // Self-lockout protection: a non-admin manager restricting a folder
      // severs their own outside-rooted grant (grants from outside a
      // restricted boundary don't flow in). Anchor them inside.
      if (input.restricted && !access.isAdmin) {
        await db
          .insert(AccessGrant)
          .values({
            workspaceId: input.workspaceId,
            principalType: "user",
            principalId: ctx.session.user.id,
            folderId: folder.id,
            role: "manager",
            createdByUserId: ctx.session.user.id,
          })
          .onConflictDoUpdate({
            target: grantUpsertTarget,
            set: { role: "manager" },
          });
      }
    }),

  captureTargets: workspaceProcedure.query(async ({ ctx }) => {
    return listCaptureTargets(ctx.access);
  }),
} satisfies TRPCRouterRecord;
