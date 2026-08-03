import type { BillingPlan, BillingStatus } from "@acme/db/schema";
import { and, count, eq, gte, ne, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  AgentConnection,
  DocSite,
  Source,
  SpendLedger,
  WorkspaceMember,
  WorkspaceSubscription,
} from "@acme/db/schema";

import { isCommunityEdition } from "./edition";
import { effectiveBillingPlan } from "./plan-transition";

// Metered dimensions. `storage` maps to PlanLimits.storageBytes.
export type Dimension =
  | "members"
  | "captures"
  | "artifact"
  | "storage"
  | "widgets"
  | "docsites";

export interface PlanLimits {
  members: number; // Infinity for unlimited
  captures: number; // per month
  artifact: number; // per month
  storageBytes: number;
  widgets: number; // standing count, not monthly
  docsites: number; // standing count, not monthly
}

export const PLAN_LIMITS: Record<BillingPlan, PlanLimits> = {
  free: {
    members: 1,
    captures: 50,
    artifact: 5,
    storageBytes: 500 * 1024 * 1024,
    widgets: 0,
    docsites: 0,
  },
  pro: {
    members: Infinity,
    captures: Infinity,
    artifact: 200,
    storageBytes: 50 * 1024 * 1024 * 1024,
    widgets: 5,
    docsites: 3,
  },
  enterprise: {
    members: Infinity,
    captures: Infinity,
    artifact: Infinity,
    storageBytes: Infinity,
    widgets: Infinity,
    docsites: Infinity,
  },
};

function effectiveLimits(
  plan: BillingPlan,
  status: BillingStatus | null,
): PlanLimits {
  return PLAN_LIMITS[effectiveBillingPlan(plan, status)];
}

function limitFor(limits: PlanLimits, dimension: Dimension): number {
  switch (dimension) {
    case "members":
      return limits.members;
    case "captures":
      return limits.captures;
    case "artifact":
      return limits.artifact;
    case "storage":
      return limits.storageBytes;
    case "widgets":
      return limits.widgets;
    case "docsites":
      return limits.docsites;
  }
}

// First instant of the current calendar month in UTC. Captures/artifact meters
// reset here.
function startOfMonthUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Maps the DB row → effective plan (status-aware: past_due still Pro). No row → free.
export async function resolveEntitlements(workspaceId: string): Promise<{
  plan: BillingPlan;
  status: BillingStatus | null;
  limits: PlanLimits;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}> {
  if (isCommunityEdition()) {
    return {
      plan: "enterprise",
      status: null,
      limits: PLAN_LIMITS.enterprise,
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  const [row] = await db
    .select()
    .from(WorkspaceSubscription)
    .where(eq(WorkspaceSubscription.workspaceId, workspaceId))
    .limit(1);

  if (!row) {
    return {
      plan: "free",
      status: null,
      limits: PLAN_LIMITS.free,
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  return {
    plan: row.plan,
    status: row.status,
    limits: effectiveLimits(row.plan, row.status),
    trialEnd: row.trialEnd,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

// Current usage for a single dimension (members live; captures/artifact this
// calendar month; storage = sum Source.sizeBytes).
async function countDimension(
  workspaceId: string,
  dimension: Dimension,
): Promise<number> {
  switch (dimension) {
    case "members": {
      const [row] = await db
        .select({ value: count() })
        .from(WorkspaceMember)
        .where(eq(WorkspaceMember.workspaceId, workspaceId));
      return row?.value ?? 0;
    }
    case "captures": {
      const [row] = await db
        .select({ value: count() })
        .from(Source)
        .where(
          and(
            eq(Source.workspaceId, workspaceId),
            gte(Source.createdAt, startOfMonthUTC()),
          ),
        );
      return row?.value ?? 0;
    }
    case "artifact": {
      const [row] = await db
        .select({ value: count() })
        .from(SpendLedger)
        .where(
          and(
            eq(SpendLedger.workspaceId, workspaceId),
            eq(SpendLedger.kind, "artifact"),
            gte(SpendLedger.createdAt, startOfMonthUTC()),
          ),
        );
      return row?.value ?? 0;
    }
    case "storage": {
      const [row] = await db
        .select({
          value: sql<number>`coalesce(sum(coalesce(${Source.sizeBytes}, 0)), 0)`,
        })
        .from(Source)
        .where(eq(Source.workspaceId, workspaceId));
      return Number(row?.value ?? 0);
    }
    case "widgets": {
      const [row] = await db
        .select({ value: count() })
        .from(AgentConnection)
        .where(
          and(
            eq(AgentConnection.workspaceId, workspaceId),
            eq(AgentConnection.platform, "widget"),
            ne(AgentConnection.status, "revoked"),
          ),
        );
      return row?.value ?? 0;
    }
    case "docsites": {
      const [row] = await db
        .select({ value: count() })
        .from(DocSite)
        .where(eq(DocSite.workspaceId, workspaceId));
      return row?.value ?? 0;
    }
  }
}

// Current usage across every metered dimension.
export async function resolveUsage(
  workspaceId: string,
): Promise<Record<Dimension, number>> {
  const [members, captures, artifact, storage, widgets, docsites] =
    await Promise.all([
      countDimension(workspaceId, "members"),
      countDimension(workspaceId, "captures"),
      countDimension(workspaceId, "artifact"),
      countDimension(workspaceId, "storage"),
      countDimension(workspaceId, "widgets"),
      countDimension(workspaceId, "docsites"),
    ]);
  return { members, captures, artifact, storage, widgets, docsites };
}

// Typed error for REST 402 mapping. tRPC sites throw TRPCError PAYMENT_REQUIRED instead.
export class EntitlementError extends Error {
  constructor(
    readonly dimension: Dimension,
    readonly limit: number,
    message: string,
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

// Throws EntitlementError if adding `amount` (default 1) to `dimension` would
// exceed the plan limit. FAIL-OPEN: on any internal/DB error, logs and returns
// (allows) — never falsely block a paying customer.
export async function assertWithinLimit(
  workspaceId: string,
  dimension: Dimension,
  amount = 1,
): Promise<void> {
  try {
    const { limits } = await resolveEntitlements(workspaceId);
    const limit = limitFor(limits, dimension);
    if (limit === Infinity) return;
    const current = await countDimension(workspaceId, dimension);
    if (current + amount > limit) {
      throw new EntitlementError(
        dimension,
        limit,
        `Workspace has reached its ${dimension} limit (${limit}).`,
      );
    }
  } catch (err) {
    if (err instanceof EntitlementError) throw err;
    console.error("[entitlements] check failed", err);
    return;
  }
}
