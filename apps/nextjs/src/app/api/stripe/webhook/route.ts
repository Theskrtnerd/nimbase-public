import "server-only";

import type Stripe from "stripe";

import type { BillingPlan, BillingStatus } from "@acme/db/schema";
import { effectiveBillingPlan } from "@acme/api/plan-transition";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { WorkspaceSubscription } from "@acme/db/schema";

import { env } from "~/env";
import { stripe } from "~/server/billing/stripe";

// Stripe SDK needs Node crypto for signature verification.
export const runtime = "nodejs";

// Stripe subscription status → our BillingStatus. The two enums currently match
// 1:1; the explicit, total map fails to compile if Stripe adds a status.
const STATUS_MAP: Record<Stripe.Subscription.Status, BillingStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "unpaid",
  incomplete: "incomplete",
  incomplete_expired: "incomplete_expired",
  paused: "paused",
};

function customerId(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

// Manual enterprise grants have a plan of "enterprise" and no Stripe
// subscription id — Stripe events must never clobber them.
function isManualEnterprise(row: {
  plan: BillingPlan;
  stripeSubscriptionId: string | null;
}): boolean {
  return row.plan === "enterprise" && !row.stripeSubscriptionId;
}

async function rowByCustomer(customer: string) {
  const [row] = await db
    .select()
    .from(WorkspaceSubscription)
    .where(eq(WorkspaceSubscription.stripeCustomerId, customer))
    .limit(1);
  return row ?? null;
}

// Resolve the owning workspace for a subscription: metadata first (set at
// checkout), then the existing row by subscription id, then by customer id.
async function resolveWorkspaceId(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromMeta = subscription.metadata.workspaceId;
  if (fromMeta) return fromMeta;

  const [bySub] = await db
    .select({ workspaceId: WorkspaceSubscription.workspaceId })
    .from(WorkspaceSubscription)
    .where(eq(WorkspaceSubscription.stripeSubscriptionId, subscription.id))
    .limit(1);
  if (bySub) return bySub.workspaceId;

  const customer = customerId(subscription.customer);
  if (!customer) return null;
  const byCustomer = await rowByCustomer(customer);
  return byCustomer?.workspaceId ?? null;
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

// Idempotent upsert of the full subscription state, keyed on the workspace
// (1:1). current_period_end now lives on the subscription item, not the
// subscription, in this API version.
async function upsertFromSubscription(
  workspaceId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const [existing] = await db
    .select({
      plan: WorkspaceSubscription.plan,
      stripeSubscriptionId: WorkspaceSubscription.stripeSubscriptionId,
    })
    .from(WorkspaceSubscription)
    .where(eq(WorkspaceSubscription.workspaceId, workspaceId))
    .limit(1);
  if (existing && isManualEnterprise(existing)) return;

  const status = STATUS_MAP[subscription.status];
  const plan = effectiveBillingPlan("pro", status);
  const customer = customerId(subscription.customer);
  const currentPeriodEnd = toDate(
    subscription.items.data[0]?.current_period_end,
  );
  const trialEnd = toDate(subscription.trial_end);

  const fields = {
    plan,
    status,
    stripeCustomerId: customer,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd,
    trialEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };

  await db
    .insert(WorkspaceSubscription)
    .values({ workspaceId, ...fields })
    .onConflictDoUpdate({
      target: WorkspaceSubscription.workspaceId,
      set: { ...fields, updatedAt: new Date() },
    });
}

// Invoice events only move status (keep the existing plan): payment_failed →
// past_due (still Pro), paid → active.
async function updateStatusByCustomer(
  customer: string,
  status: BillingStatus,
): Promise<void> {
  const row = await rowByCustomer(customer);
  if (!row || isManualEnterprise(row)) return;
  await db
    .update(WorkspaceSubscription)
    .set({ status, updatedAt: new Date() })
    .where(eq(WorkspaceSubscription.workspaceId, row.workspaceId));
}

export async function POST(req: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return new Response("Stripe billing is not configured", { status: 404 });
  }

  // Must read the raw body for signature verification — never req.json() first.
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response("missing signature", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed", err);
    return new Response("invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        let subscription: Stripe.Subscription | null = null;
        if (typeof session.subscription === "string") {
          subscription = await stripe.subscriptions.retrieve(
            session.subscription,
          );
        } else if (session.subscription) {
          subscription = session.subscription;
        }
        if (subscription) {
          const workspaceId =
            session.client_reference_id ??
            (await resolveWorkspaceId(subscription));
          if (workspaceId) {
            await upsertFromSubscription(workspaceId, subscription);
          }
        }
        break;
      }
      // A deleted subscription arrives with status "canceled", which
      // The effective-plan policy maps canceled to free, so the same upsert
      // handles both.
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const workspaceId = await resolveWorkspaceId(subscription);
        if (workspaceId) {
          await upsertFromSubscription(workspaceId, subscription);
        }
        break;
      }
      case "invoice.payment_failed": {
        const customer = customerId(event.data.object.customer);
        if (customer) await updateStatusByCustomer(customer, "past_due");
        break;
      }
      case "invoice.paid": {
        const customer = customerId(event.data.object.customer);
        if (customer) await updateStatusByCustomer(customer, "active");
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Signature already verified — return 200 so Stripe does not retry forever
    // on an application bug. Transient DB errors are accepted as a known
    // trade-off (kept simple per the design spec).
    console.error("[stripe webhook] handler error", event.type, err);
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
}
