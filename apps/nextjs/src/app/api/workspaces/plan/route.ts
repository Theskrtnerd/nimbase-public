import { clerkClient } from "@clerk/nextjs/server";

import { isCommunityEdition } from "@acme/api/edition";
import { isGod } from "@acme/api/operator";
import { setPlanOverride } from "@acme/api/plan-override";
import { decidePlanTransition } from "@acme/api/plan-transition";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Workspace, WorkspaceSubscription } from "@acme/db/schema";
import { setPlanRequestSchema } from "@acme/validators/cli";

import {
  authorizeUserRequest,
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import {
  createCheckoutSession,
  createPortalSession,
} from "~/server/billing/stripe";

export const runtime = "nodejs";

const ENTERPRISE_SALES_URL =
  "mailto:nimbase.ai@gmail.com?subject=Nimbase%20Enterprise%20inquiry";
const ENTERPRISE_SUPPORT_URL =
  "mailto:support@nimbase.ai?subject=Nimbase%20Enterprise%20plan%20change";
const STRIPE_OVERRIDE_WARNING =
  "This workspace has a live Stripe subscription; a later Stripe webhook may overwrite the direct override.";

export async function POST(request: Request): Promise<Response> {
  const parsed = setPlanRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const userId = await authorizeUserRequest(request);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const community = isCommunityEdition();
  let staff = false;
  if (!community) {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    staff = isGod(user.primaryEmailAddress?.emailAddress);
  }

  if (!staff) {
    const authorized = await authorizeWorkspaceRequest(
      request,
      parsed.data.workspaceId,
    );
    if (!authorized.ok) return authzErrorResponse(authorized);
    if (authorized.access.role !== "owner" || !authorized.userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const workspace = await getWorkspaceBilling(parsed.data.workspaceId);
  if (!workspace) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (community) {
    return Response.json({ action: "unchanged", plan: "enterprise" });
  }
  const transition = decidePlanTransition({
    current: workspace.billing,
    target: parsed.data.plan,
    staff,
  });

  if (transition.action === "unchanged") {
    return Response.json({ action: "unchanged", plan: parsed.data.plan });
  }
  if (transition.action === "contact_sales") {
    return Response.json({
      action: "contact",
      plan: parsed.data.plan,
      reason: "enterprise_sales",
      url: ENTERPRISE_SALES_URL,
    });
  }
  if (transition.action === "contact_support") {
    return Response.json({
      action: "contact",
      plan: parsed.data.plan,
      reason: "enterprise_support",
      url: ENTERPRISE_SUPPORT_URL,
    });
  }
  if (transition.action === "override") {
    const result = await setPlanOverride({
      workspaceId: workspace.id,
      plan: parsed.data.plan,
      operatorUserId: userId,
    });
    return Response.json({
      action: "override",
      ...result,
      warning: transition.stripeManaged ? STRIPE_OVERRIDE_WARNING : null,
    });
  }
  if (transition.action === "portal") {
    try {
      const { url } = await createPortalSession({
        workspaceId: workspace.id,
        baseUrl: new URL(request.url).origin,
      });
      return Response.json({
        action: "portal",
        plan: parsed.data.plan,
        url,
      });
    } catch (error) {
      console.error("[workspaces/plan] portal failed", error);
      return Response.json({ error: "portal_failed" }, { status: 500 });
    }
  }

  try {
    const { url } = await createCheckoutSession({
      workspaceId: workspace.id,
      userId,
      baseUrl: new URL(request.url).origin,
    });
    return Response.json({ action: "checkout", plan: "pro", url });
  } catch (error) {
    console.error("[workspaces/plan] checkout failed", error);
    return Response.json({ error: "checkout_failed" }, { status: 500 });
  }
}

async function getWorkspaceBilling(workspaceId: string) {
  const [row] = await db
    .select({
      id: Workspace.id,
      plan: WorkspaceSubscription.plan,
      status: WorkspaceSubscription.status,
      stripeSubscriptionId: WorkspaceSubscription.stripeSubscriptionId,
    })
    .from(Workspace)
    .leftJoin(
      WorkspaceSubscription,
      eq(WorkspaceSubscription.workspaceId, Workspace.id),
    )
    .where(eq(Workspace.id, workspaceId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    billing: {
      plan: row.plan ?? "free",
      status: row.status ?? null,
      stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    },
  };
}
