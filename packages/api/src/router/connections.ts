import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { sourceConnectionConfigSchema } from "@acme/db/schema";

import {
  ConnectionControlError,
  deleteConnection,
  listConnectionsForAccess,
  requireSyncableConnection,
  setConnectionPaused,
  updateConnection,
} from "../lib/connection-control";
import { workspaceProcedure } from "../trpc";

function asTrpcError(error: unknown): never {
  if (error instanceof ConnectionControlError) {
    throw new TRPCError({
      code: error.code === "not_found" ? "NOT_FOUND" : "BAD_REQUEST",
      message: error.message,
    });
  }
  throw error;
}

export const connectionsRouter = {
  // Which integration providers are configured (app injects the CrawlPort).
  providers: workspaceProcedure.query(({ ctx }) => {
    return ctx.crawl?.providers() ?? [];
  }),

  // Connections whose target folder the caller can read.
  list: workspaceProcedure.query(({ ctx }) =>
    listConnectionsForAccess(ctx.access),
  ),

  setPaused: workspaceProcedure
    .input(z.object({ connectionId: z.string().uuid(), paused: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await setConnectionPaused({
          access: ctx.access,
          connectionId: input.connectionId,
          paused: input.paused,
        });
      } catch (error) {
        asTrpcError(error);
      }
      return { ok: true };
    }),

  update: workspaceProcedure
    .input(
      z.object({
        connectionId: z.string().uuid(),
        displayName: z.string().max(200).optional(),
        intervalSeconds: z.number().int().min(300).max(2_592_000).optional(),
        config: sourceConnectionConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await updateConnection({
          access: ctx.access,
          connectionId: input.connectionId,
          displayName: input.displayName,
          intervalSeconds: input.intervalSeconds,
          config: input.config,
        });
      } catch (error) {
        asTrpcError(error);
      }
      return { ok: true };
    }),

  syncNow: workspaceProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireSyncableConnection(ctx.access, input.connectionId);
      } catch (error) {
        asTrpcError(error);
      }
      if (!ctx.crawl) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Crawl port not configured",
        });
      }
      const { runId } = await ctx.crawl.enqueue({
        connectionId: input.connectionId,
        workspaceId: input.workspaceId,
      });
      return { ok: true, runId };
    }),

  delete: workspaceProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await deleteConnection(ctx.access, input.connectionId);
      } catch (error) {
        asTrpcError(error);
      }
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
