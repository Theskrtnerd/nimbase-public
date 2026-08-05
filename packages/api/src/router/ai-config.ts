import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { modelsForRole } from "@acme/runtime/ai";

import { assertAdmin } from "../lib/access";
import {
  getWorkspaceAiConfig,
  updateWorkspaceAiConfig,
  WorkspaceAiConfigError,
} from "../lib/workspace-ai-config";
import { workspaceProcedure } from "../trpc";

// Per-workspace overrides for chat + normalize (embed is installation-wide).
// Gated by workspace admin/owner.
// null override columns inherit the global config; the resolver already merges
// workspace → global → defaults, so no resolver change is needed here.
export const workspaceAiConfigRouter = {
  options: workspaceProcedure.query(() => ({
    chat: modelsForRole("chat"),
    normalize: modelsForRole("normalize"),
  })),

  get: workspaceProcedure.query(async ({ ctx, input }) => {
    assertAdmin(ctx.access);
    return getWorkspaceAiConfig(input.workspaceId);
  }),

  update: workspaceProcedure
    .input(
      z.object({
        chatModel: z.string().nullable(),
        normalizeModel: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.access);
      try {
        await updateWorkspaceAiConfig(input.workspaceId, input);
      } catch (error) {
        if (error instanceof WorkspaceAiConfigError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
