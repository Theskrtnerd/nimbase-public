import "server-only";

import type { ApiSession } from "@acme/api";
import { appRouter, createTRPCContext } from "@acme/api";

/**
 * Build a tRPC session from an OAuth-resolved Clerk user id. The MCP read path
 * never needs the user's name/email, so they stay null (capture resolves a
 * display name itself when it matters).
 */
export function mcpSession(userId: string): ApiSession {
  return { user: { id: userId, name: null, email: null } };
}

/**
 * In-process tRPC caller scoped to an OAuth user. Procedures run their own
 * per-workspace ownership checks, so MCP tools inherit authorization for free.
 */
export function createMcpCaller(userId: string) {
  return appRouter.createCaller(
    createTRPCContext({ session: mcpSession(userId) }),
  );
}
