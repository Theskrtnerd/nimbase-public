import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  ApiToken,
  artifactVisibilitySchema,
  GroupMcp,
  groupMcpNeedsWriteRole,
  groupMcpToolSchema,
  WikiNode,
} from "@acme/db/schema";
import { isReservedSlug } from "@acme/db/slug";

import { assertAdmin } from "../lib/access";
import {
  createGroupMcpRecord,
  DeploymentSurfaceError,
} from "../lib/deployment-surfaces-control";
import { workspaceProcedure } from "../trpc";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use a kebab-case slug")
  .max(64)
  .refine((slug) => !isReservedSlug(slug), "That slug is reserved");

export const groupMcpCreateInput = z.object({
  workspaceId: z.string().uuid(),
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(4000).default(""),
  folderPath: z.string().trim().min(1).max(512).optional(),
  tools: z.array(groupMcpToolSchema).min(1),
  authMethods: z.array(z.enum(["api_key", "oauth"])).min(1),
});

export const groupMcpRouter = {
  list: workspaceProcedure.query(async ({ ctx, input }) => {
    assertAdmin(ctx.access);
    return db
      .select({
        id: GroupMcp.id,
        slug: GroupMcp.slug,
        name: GroupMcp.name,
        instructions: GroupMcp.instructions,
        folderPath: sql<string>`coalesce(${WikiNode.path}, '')`,
        enabled: GroupMcp.enabled,
        tools: GroupMcp.tools,
        authMethods: GroupMcp.authMethods,
        artifactVisibility: GroupMcp.artifactVisibility,
      })
      .from(GroupMcp)
      .leftJoin(WikiNode, eq(WikiNode.id, GroupMcp.folderId))
      .where(eq(GroupMcp.workspaceId, input.workspaceId))
      .orderBy(GroupMcp.slug);
  }),

  create: workspaceProcedure
    .input(groupMcpCreateInput)
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const needsApiKey = input.authMethods.includes("api_key");
      if (needsApiKey && !ctx.tokens) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Token minting unavailable",
        });
      }
      let deployment: Awaited<ReturnType<typeof createGroupMcpRecord>>;
      try {
        deployment = await createGroupMcpRecord(input);
      } catch (error) {
        if (error instanceof DeploymentSurfaceError) {
          throw new TRPCError({
            code: error.code === "conflict" ? "CONFLICT" : "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }

      let token: string | null = null;
      if (needsApiKey && ctx.tokens) {
        try {
          const minted = await ctx.tokens.mint({
            workspaceId: input.workspaceId,
            role: groupMcpNeedsWriteRole(input.tools)
              ? "contributor"
              : "viewer",
            folderId: deployment.folderId,
            label: `MCP: ${input.name}`,
            groupMcpId: deployment.id,
          });
          token = minted.token;
        } catch (error) {
          await db.delete(GroupMcp).where(eq(GroupMcp.id, deployment.id));
          throw error;
        }
      }
      return {
        deploymentId: deployment.id,
        folderId: deployment.folderId,
        token,
      };
    }),

  propose: workspaceProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        prompt: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      if (!ctx.groupMcpAI) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "AI proposal unavailable",
        });
      }
      const proposal = await ctx.groupMcpAI.propose({
        workspaceId: input.workspaceId,
        prompt: input.prompt,
        readScopes: ctx.access.scopes("viewer"),
      });
      return proposal;
    }),

  get: workspaceProcedure
    .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const [row] = await db
        .select()
        .from(GroupMcp)
        .where(
          and(
            eq(GroupMcp.id, input.id),
            eq(GroupMcp.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  update: workspaceProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        instructions: z.string().trim().max(4000).optional(),
        tools: z.array(groupMcpToolSchema).min(1).optional(),
        authMethods: z
          .array(z.enum(["api_key", "oauth"]))
          .min(1)
          .optional(),
        artifactVisibility: artifactVisibilitySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      await db
        .update(GroupMcp)
        .set({
          name: input.name,
          instructions: input.instructions,
          tools: input.tools,
          authMethods: input.authMethods,
          artifactVisibility: input.artifactVisibility,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(GroupMcp.id, input.id),
            eq(GroupMcp.workspaceId, input.workspaceId),
          ),
        );
      return { ok: true };
    }),

  setEnabled: workspaceProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        id: z.string().uuid(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      await db
        .update(GroupMcp)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(GroupMcp.id, input.id),
            eq(GroupMcp.workspaceId, input.workspaceId),
          ),
        );
      return { ok: true };
    }),

  rotateKey: workspaceProcedure
    .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      if (!ctx.tokens) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Token minting unavailable",
        });
      }
      const tokens = ctx.tokens;
      const [deployment] = await db
        .select({
          folderId: GroupMcp.folderId,
          name: GroupMcp.name,
          tools: GroupMcp.tools,
        })
        .from(GroupMcp)
        .where(
          and(
            eq(GroupMcp.id, input.id),
            eq(GroupMcp.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!deployment) throw new TRPCError({ code: "NOT_FOUND" });
      const existing = await db
        .select({ id: ApiToken.id })
        .from(ApiToken)
        .where(eq(ApiToken.groupMcpId, input.id));
      await Promise.all(existing.map(({ id }) => tokens.revoke(id)));
      const minted = await tokens.mint({
        workspaceId: input.workspaceId,
        role: groupMcpNeedsWriteRole(deployment.tools)
          ? "contributor"
          : "viewer",
        folderId: deployment.folderId,
        label: `MCP: ${deployment.name}`,
        groupMcpId: input.id,
      });
      return { token: minted.token };
    }),

  delete: workspaceProcedure
    .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      await db
        .delete(GroupMcp)
        .where(
          and(
            eq(GroupMcp.id, input.id),
            eq(GroupMcp.workspaceId, input.workspaceId),
          ),
        );
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
