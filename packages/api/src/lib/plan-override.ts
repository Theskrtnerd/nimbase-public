import type { BillingPlan, BillingStatus } from "@acme/db/schema";
import { db } from "@acme/db/client";
import { WorkspaceSubscription } from "@acme/db/schema";

import { logGodModeAccess } from "./operator";

/**
 * Operator-only manual plan grant — the Enterprise mechanism, and how gods hold
 * a paid plan without going through Stripe checkout. Touches no Stripe
 * subscription, so granted rows have no stripeSubscriptionId and the webhook
 * never clobbers them.
 *
 * Auth-agnostic: the caller must already have asserted god-mode. Shared by the
 * `billing.setPlanOverride` tRPC mutation (dashboard) and the public workspace
 * plan route (CLI), so the two surfaces cannot drift on what a grant writes.
 */
export async function setPlanOverride(args: {
  workspaceId: string;
  plan: BillingPlan;
  operatorUserId: string;
}): Promise<{ plan: BillingPlan; status: BillingStatus | null }> {
  // The status must be written alongside the plan: effectiveLimits() only
  // honours `pro` while the status is trialing/active/past_due, so a grant that
  // left status null would read back as Pro in the UI but enforce Free limits.
  // `active` is the honest description of a comped subscription. Enterprise
  // ignores status entirely, and free has no limits to unlock, so both null it
  // out rather than inventing a Stripe-shaped state.
  const status: BillingStatus | null = args.plan === "pro" ? "active" : null;

  await db
    .insert(WorkspaceSubscription)
    .values({ workspaceId: args.workspaceId, plan: args.plan, status })
    .onConflictDoUpdate({
      target: WorkspaceSubscription.workspaceId,
      set: { plan: args.plan, status, updatedAt: new Date() },
    });

  // Every grant is auditable, whichever surface issued it.
  await logGodModeAccess({
    operatorUserId: args.operatorUserId,
    workspaceId: args.workspaceId,
    action: `billing.setPlanOverride:${args.plan}`,
  });

  return { plan: args.plan, status };
}
