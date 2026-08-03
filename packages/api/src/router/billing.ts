import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { resolveEntitlements, resolveUsage } from "../lib/entitlements";
import { assertGod } from "../lib/operator";
import { setPlanOverride } from "../lib/plan-override";
import { workspaceProcedure } from "../trpc";

// tRPC serializes over JSON, where `Infinity` is not representable (it becomes
// `null` and superjson does not special-case it). Unlimited dimensions are
// therefore returned as `null`; the UI renders these as "Unlimited".
function jsonLimit(limit: number): number | null {
  return limit === Infinity ? null : limit;
}

export const billingRouter = {
  // Any workspace member may read their own plan + usage (mutations are gated
  // elsewhere: checkout/portal are owner-only REST routes; setPlanOverride is
  // operator-only). No admin assert here.
  get: workspaceProcedure.query(async ({ input }) => {
    const [entitlements, usage] = await Promise.all([
      resolveEntitlements(input.workspaceId),
      resolveUsage(input.workspaceId),
    ]);
    return {
      plan: entitlements.plan,
      status: entitlements.status,
      // Infinity → null for JSON safety (see jsonLimit).
      limits: {
        members: jsonLimit(entitlements.limits.members),
        captures: jsonLimit(entitlements.limits.captures),
        artifact: jsonLimit(entitlements.limits.artifact),
        storageBytes: jsonLimit(entitlements.limits.storageBytes),
      },
      usage,
      trialEnd: entitlements.trialEnd,
      currentPeriodEnd: entitlements.currentPeriodEnd,
      cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
    };
  }),

  // Gated here, executed in the shared control layer so the workspace plan
  // route used by the CLI writes exactly the same rows for staff overrides.
  setPlanOverride: workspaceProcedure
    .input(z.object({ plan: z.enum(["free", "pro", "enterprise"]) }))
    .mutation(async ({ ctx, input }) => {
      assertGod(await ctx.resolveEmail());
      return setPlanOverride({
        workspaceId: input.workspaceId,
        plan: input.plan,
        operatorUserId: ctx.session.user.id,
      });
    }),
} satisfies TRPCRouterRecord;
