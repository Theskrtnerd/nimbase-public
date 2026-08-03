import type { BillingPlan, BillingStatus } from "@acme/db/schema";

export interface BillingSnapshot {
  plan: BillingPlan;
  status: BillingStatus | null;
  stripeSubscriptionId: string | null;
}

export type PlanTransition =
  | { action: "unchanged" }
  | { action: "checkout" }
  | { action: "portal" }
  | { action: "contact_sales" }
  | { action: "contact_support" }
  | { action: "override"; stripeManaged: boolean };

const TERMINAL_STRIPE_STATUSES = new Set<BillingStatus>([
  "canceled",
  "incomplete_expired",
]);

/** Status-aware plan: Enterprise is manual; Pro remains entitled during dunning. */
export function effectiveBillingPlan(
  plan: BillingPlan,
  status: BillingStatus | null,
): BillingPlan {
  if (plan === "enterprise") return "enterprise";
  if (status === "trialing" || status === "active" || status === "past_due") {
    return plan;
  }
  return "free";
}

/**
 * Decide the one safe action that moves a workspace toward a requested plan.
 * This is deliberately pure: Stripe, persistence, and CLI/browser output are
 * adapters around this policy rather than alternate implementations of it.
 */
export function decidePlanTransition(args: {
  current: BillingSnapshot;
  target: BillingPlan;
  staff: boolean;
}): PlanTransition {
  const currentPlan = effectiveBillingPlan(
    args.current.plan,
    args.current.status,
  );
  const stripeManaged = hasLiveStripeSubscription(args.current);
  const liveSubscriptionNeedsCancellation =
    args.target === "free" && stripeManaged;
  if (currentPlan === args.target && !liveSubscriptionNeedsCancellation) {
    return { action: "unchanged" };
  }

  if (args.staff) return { action: "override", stripeManaged };

  if (currentPlan === "enterprise") return { action: "contact_support" };
  if (args.target === "enterprise") return { action: "contact_sales" };
  if (args.target === "free") return { action: "portal" };
  return { action: stripeManaged ? "portal" : "checkout" };
}

function hasLiveStripeSubscription(snapshot: BillingSnapshot): boolean {
  if (!snapshot.stripeSubscriptionId) return false;
  return (
    snapshot.status === null || !TERMINAL_STRIPE_STATUSES.has(snapshot.status)
  );
}
