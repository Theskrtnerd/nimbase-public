import "server-only";

import Stripe from "stripe";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { WorkspaceSubscription } from "@acme/db/schema";

import { env } from "~/env";

// Pinned to the API version the installed `stripe` package's types declare
// (Stripe.LatestApiVersion === "2026-06-24.dahlia"). Pinning keeps request /
// response shapes stable across SDK bumps; bump deliberately when upgrading.
//
// Constructed lazily behind a Proxy: `new Stripe()` throws if STRIPE_SECRET_KEY
// is absent, and `next build` evaluates this module while collecting API-route
// page data — so eager construction broke the build in any env without the key.
// The Proxy defers construction to the first property access (a real request),
// keeping the exported `stripe.*` surface unchanged for every call site.
let stripeClient: Stripe | null = null;
function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe billing is not configured");
  }
  return (stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-06-24.dahlia",
  }));
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripeClient();
    const value = Reflect.get(client, prop, receiver) as unknown;
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});

// Stripe redirects (checkout success/cancel, portal return) land back on the
// workspace dashboard, where the billing settings panel reads ?billing=<state>.
function billingSettingsUrl(
  baseUrl: string,
  workspaceId: string,
  state: string,
): string {
  return `${baseUrl}/dashboard/workspaces/${workspaceId}?billing=${state}`;
}

// Returns the workspace's Stripe customer id, creating + persisting one when
// absent. The new id is upserted onto the (1:1) WorkspaceSubscription row.
export async function getOrCreateCustomer(
  workspaceId: string,
): Promise<string> {
  const [row] = await db
    .select({ stripeCustomerId: WorkspaceSubscription.stripeCustomerId })
    .from(WorkspaceSubscription)
    .where(eq(WorkspaceSubscription.workspaceId, workspaceId))
    .limit(1);

  if (row?.stripeCustomerId) return row.stripeCustomerId;

  const customer = await stripe.customers.create({
    metadata: { workspaceId },
  });

  await db
    .insert(WorkspaceSubscription)
    .values({ workspaceId, stripeCustomerId: customer.id })
    .onConflictDoUpdate({
      target: WorkspaceSubscription.workspaceId,
      set: { stripeCustomerId: customer.id, updatedAt: new Date() },
    });

  return customer.id;
}

// Hosted Checkout for the Pro plan: 7-day trial, card required up front
// (payment_method_collection: "always"). The subscription carries workspaceId
// in metadata so the webhook can resolve the row even off the customer id.
export async function createCheckoutSession(args: {
  workspaceId: string;
  userId: string;
  baseUrl: string;
}): Promise<{ url: string }> {
  if (!env.STRIPE_PRICE_PRO) {
    throw new Error("Stripe Pro pricing is not configured");
  }
  const customer = await getOrCreateCustomer(args.workspaceId);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: env.STRIPE_PRICE_PRO, quantity: 1 }],
    subscription_data: {
      trial_period_days: 7,
      metadata: { workspaceId: args.workspaceId },
    },
    payment_method_collection: "always",
    client_reference_id: args.workspaceId,
    success_url: billingSettingsUrl(args.baseUrl, args.workspaceId, "success"),
    cancel_url: billingSettingsUrl(args.baseUrl, args.workspaceId, "cancel"),
  });
  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL");
  }
  return { url: session.url };
}

// Customer Portal for managing / cancelling an existing subscription.
export async function createPortalSession(args: {
  workspaceId: string;
  baseUrl: string;
}): Promise<{ url: string }> {
  const customer = await getOrCreateCustomer(args.workspaceId);
  const session = await stripe.billingPortal.sessions.create({
    customer,
    return_url:
      env.STRIPE_PORTAL_RETURN_URL ??
      billingSettingsUrl(args.baseUrl, args.workspaceId, "return"),
  });
  return { url: session.url };
}
