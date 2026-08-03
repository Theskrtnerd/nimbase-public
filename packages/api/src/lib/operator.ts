import { TRPCError } from "@trpc/server";

import { db } from "@acme/db/client";
import { OperatorAuditLog } from "@acme/db/schema";

// Gods are platform staff listed in GODS (comma-separated email addresses).
// This is the single source of truth for the env-allowlist check — matching by
// email (case-insensitive) rather than Clerk user id so the list is legible.
export function isGod(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = (process.env.GODS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

export function assertGod(email: string | null | undefined): void {
  if (!isGod(email)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Operator only" });
  }
}

// Records one row per god-mode read. Best-effort: a logging failure must not
// break the support view, so callers await it but it never throws on its own.
export async function logGodModeAccess(args: {
  operatorUserId: string;
  workspaceId: string;
  action: string;
}): Promise<void> {
  try {
    await db.insert(OperatorAuditLog).values({
      operatorUserId: args.operatorUserId,
      workspaceId: args.workspaceId,
      action: args.action,
    });
  } catch (err) {
    console.error("logGodModeAccess: audit insert failed", err);
  }
}
