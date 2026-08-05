// Community Edition never applies hosted-plan gates. This module preserves the
// shared call-site contract so core services do not need billing branches.

export type Dimension =
  | "members"
  | "captures"
  | "artifact"
  | "storage"
  | "widgets";

export interface PlanLimits {
  members: number;
  captures: number;
  artifact: number;
  storageBytes: number;
  widgets: number;
}

export const COMMUNITY_LIMITS: PlanLimits = {
  members: Infinity,
  captures: Infinity,
  artifact: Infinity,
  storageBytes: Infinity,
  widgets: Infinity,
};

export function resolveEntitlements(_workspaceId: string): Promise<{
  plan: "community";
  status: null;
  limits: PlanLimits;
  trialEnd: null;
  currentPeriodEnd: null;
  cancelAtPeriodEnd: false;
}> {
  return Promise.resolve({
    plan: "community",
    status: null,
    limits: COMMUNITY_LIMITS,
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
}

// Retained as a stable error contract for clients that also target Nimbase
// Cloud. Community Edition never throws this error.
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

export async function assertWithinLimit(
  _workspaceId: string,
  _dimension: Dimension,
  _amount = 1,
): Promise<void> {
  // Intentionally unlimited in Community Edition.
}
