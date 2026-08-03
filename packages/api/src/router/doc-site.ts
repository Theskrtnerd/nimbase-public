import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  DocSite,
  DocSiteBuild,
  docSiteVisibilitySchema,
} from "@acme/db/schema";

import { assertAdmin } from "../lib/access";
import {
  createDocSiteDeployment,
  deleteDocSiteDeployment,
  DeploymentSurfaceError,
  getDocSiteDeployment,
  listDocSiteDeployments,
  publishDocSiteDeployment,
} from "../lib/deployment-surfaces-control";
import { EntitlementError } from "../lib/entitlements";
import { workspaceProcedure } from "../trpc";

// Published documentation sites — the durable, multi-page sibling of Artifact,
// built on cloudflare/nimbus. This router is the web dashboard's transport over
// the same control layer the CLI's REST routes use, so neither surface can
// drift from the other on what a docs site is or who may change one.
//
// Admin-only throughout: a docs site publishes company memory to people outside
// the company, which is a governance decision, not an authoring one.

const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by -");

/** Map the shared control layer's errors onto tRPC codes, once. */
function rethrow(error: unknown): never {
  if (error instanceof DeploymentSurfaceError) {
    throw new TRPCError({
      code:
        error.code === "not_found"
          ? "NOT_FOUND"
          : error.code === "conflict"
            ? "CONFLICT"
            : "BAD_REQUEST",
      message: error.message,
    });
  }
  if (error instanceof EntitlementError) {
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: error.message,
    });
  }
  throw error;
}

export const docSiteRouter = {
  list: workspaceProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx.access);
    return listDocSiteDeployments(ctx.access.workspaceId);
  }),

  get: workspaceProcedure
    .input(z.object({ slug: slugSchema }))
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      try {
        return await getDocSiteDeployment(ctx.access.workspaceId, input.slug);
      } catch (error) {
        rethrow(error);
      }
    }),

  create: workspaceProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        folderPath: z.string().trim().min(1).max(512).optional(),
        slug: slugSchema.optional(),
        description: z.string().trim().max(500).optional(),
        instructions: z.string().trim().max(4000).optional(),
        visibility: docSiteVisibilitySchema.default("private"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      try {
        return await createDocSiteDeployment({
          ...input,
          workspaceId: ctx.access.workspaceId,
          userId: ctx.access.userId ?? "",
        });
      } catch (error) {
        rethrow(error);
      }
    }),

  update: workspaceProcedure
    .input(
      z.object({
        slug: slugSchema,
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).optional(),
        instructions: z.string().trim().max(4000).optional(),
        visibility: docSiteVisibilitySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      const { slug, name, visibility, description, instructions } = input;
      const [existing] = await db
        .select({ id: DocSite.id, config: DocSite.config })
        .from(DocSite)
        .where(
          and(
            eq(DocSite.workspaceId, ctx.access.workspaceId),
            eq(DocSite.slug, slug),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Docs site not found",
        });
      }

      await db
        .update(DocSite)
        .set({
          ...(name === undefined ? {} : { name }),
          ...(visibility === undefined ? {} : { visibility }),
          // Config is merged, not replaced: editing the description from the
          // dashboard must not silently clear the curate instructions.
          config: {
            ...existing.config,
            ...(description === undefined ? {} : { description }),
            ...(instructions === undefined ? {} : { instructions }),
          },
        })
        .where(eq(DocSite.id, existing.id));

      // Changes only reach readers on the next build; the caller decides when.
      return getDocSiteDeployment(ctx.access.workspaceId, slug);
    }),

  publish: workspaceProcedure
    .input(z.object({ slug: slugSchema }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      if (!ctx.docSites) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Publishing is not available in this environment",
        });
      }
      try {
        return await publishDocSiteDeployment(
          ctx.access.workspaceId,
          input.slug,
          ctx.docSites,
          ctx.access.userId ?? undefined,
        );
      } catch (error) {
        rethrow(error);
      }
    }),

  /** Recent builds for the status panel, newest first. */
  builds: workspaceProcedure
    .input(
      z.object({
        slug: slugSchema,
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      return db
        .select({
          id: DocSiteBuild.id,
          status: DocSiteBuild.status,
          pageCount: DocSiteBuild.pageCount,
          log: DocSiteBuild.log,
          error: DocSiteBuild.error,
          startedAt: DocSiteBuild.startedAt,
          finishedAt: DocSiteBuild.finishedAt,
        })
        .from(DocSiteBuild)
        .innerJoin(DocSite, eq(DocSite.id, DocSiteBuild.docSiteId))
        .where(
          and(
            eq(DocSiteBuild.workspaceId, ctx.access.workspaceId),
            eq(DocSite.slug, input.slug),
          ),
        )
        .orderBy(desc(DocSiteBuild.startedAt))
        .limit(input.limit);
    }),

  delete: workspaceProcedure
    .input(z.object({ slug: slugSchema }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      try {
        await deleteDocSiteDeployment(ctx.access.workspaceId, input.slug);
        return { ok: true };
      } catch (error) {
        rethrow(error);
      }
    }),
} satisfies TRPCRouterRecord;
