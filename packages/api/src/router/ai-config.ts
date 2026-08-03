import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import {
  getGlobalConfig,
  invalidateGlobalConfig,
  isValidModelForRole,
  modelsForRole,
} from "@acme/cloud";
import { db } from "@acme/db/client";
import { AI_CONFIG_ID, AiConfig, aiProviderKindSchema } from "@acme/db/schema";

import { assertAdmin } from "../lib/access";
import { assertGod } from "../lib/operator";
import {
  getWorkspaceAiConfig,
  updateWorkspaceAiConfig,
  WorkspaceAiConfigError,
} from "../lib/workspace-ai-config";
import { protectedProcedure, workspaceProcedure } from "../trpc";

const updateInput = z.object({
  providerKind: aiProviderKindSchema,
  baseUrl: z.string().url(),
  chatModel: z.string(),
  normalizeModel: z.string(),
  embedModel: z.string(),
});

export const aiConfigRouter = {
  // The selectable menu for the settings UI. Not operator-gated so the panel
  // can render the dropdowns; the get/update below are the protected surface.
  options: protectedProcedure.query(() => ({
    chat: modelsForRole("chat"),
    normalize: modelsForRole("normalize"),
    embed: modelsForRole("embed"),
  })),

  get: protectedProcedure.query(async ({ ctx }) => {
    assertGod(await ctx.resolveEmail());
    return getGlobalConfig();
  }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      assertGod(await ctx.resolveEmail());
      if (
        !isValidModelForRole(input.chatModel, "chat") ||
        !isValidModelForRole(input.normalizeModel, "normalize") ||
        !isValidModelForRole(input.embedModel, "embed")
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid model for role",
        });
      }
      await db
        .insert(AiConfig)
        .values({ id: AI_CONFIG_ID, ...input })
        .onConflictDoUpdate({
          target: AiConfig.id,
          set: { ...input, updatedAt: new Date() },
        });
      invalidateGlobalConfig();
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;

// Per-workspace overrides for chat + normalize (embed is global-only). Gated by
// workspace admin/owner — distinct from the operator gate on the global router.
// null override columns inherit the global config; the resolver already merges
// workspace → global → defaults, so no resolver change is needed here.
export const workspaceAiConfigRouter = {
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
