import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import type { AccessContext } from "@acme/api/access";
import { buildAccessContext, resolveAccess } from "@acme/api/access";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode } from "@acme/db/schema";

import { verifySessionToken } from "~/lib/desktop-auth";
import { verifyApiToken } from "./api-token";

export interface AuthorizedWorkspace {
  workspaceId: string;
  // Clerk user id of the caller, or null for the ApiToken path (no user).
  userId: string | null;
  access: AccessContext;
  apiToken?: {
    id: string;
    groupMcpId: string | null;
  };
}

// Resolve a Clerk userId from a Bearer session token (extension) or, failing
// that, the Clerk session cookie (web app same-origin fetch).
async function userIdFromRequest(req: Request): Promise<string | null> {
  const authorizationHeader = req.headers.get("authorization");
  if (authorizationHeader?.startsWith("Bearer ")) {
    const raw = authorizationHeader.slice("Bearer ".length).trim();
    return verifySessionToken(raw)?.userId ?? null;
  }
  const { userId } = await auth();
  return userId ?? null;
}

// Resolve only a real user session. Unlike workspace authorization, this does
// not accept an ApiToken and is suitable for account-level operations such as
// creating a workspace.
export async function authorizeUserRequest(
  req: Request,
): Promise<string | null> {
  return userIdFromRequest(req);
}

// Authorize an ApiToken Bearer header on its own (no user, no cookie). The
// token acts as a member with a single grant on its folder scope. Shared by
// the REST routes (via authorizeWorkspaceRequest) and the MCP transport.
export async function authorizeApiToken(
  authorizationHeader: string | null,
): Promise<AuthorizedWorkspace | null> {
  const apiToken = await verifyApiToken(authorizationHeader);
  if (!apiToken) return null;

  // Resolve the token's folder scope ("" = root). A soft-deleted scope
  // folder invalidates the token rather than silently widening it.
  let tokenPrefix = "";
  if (apiToken.folderId) {
    const [folder] = await db
      .select({ path: WikiNode.path })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.id, apiToken.folderId),
          eq(WikiNode.workspaceId, apiToken.workspaceId),
          isNull(WikiNode.deletedAt),
        ),
      )
      .limit(1);
    if (!folder) return null;
    tokenPrefix = folder.path;
  }
  const restrictedRows = await db
    .select({ path: WikiNode.path })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.workspaceId, apiToken.workspaceId),
        eq(WikiNode.restricted, true),
        isNull(WikiNode.deletedAt),
      ),
    );
  const access = buildAccessContext({
    workspaceId: apiToken.workspaceId,
    userId: null,
    role: "member",
    grants: [{ prefix: tokenPrefix, role: apiToken.role }],
    restricted: restrictedRows.map((row) => row.path),
  });
  return {
    workspaceId: apiToken.workspaceId,
    userId: null,
    access,
    apiToken: {
      id: apiToken.tokenId,
      groupMcpId: apiToken.groupMcpId,
    },
  };
}

/**
 * Why authorization failed. Kept distinct because collapsing all three into a
 * single 401 made every client tell the user to log in again — including the
 * common case of a valid credential pointed at a workspace it cannot see,
 * where logging in again changes nothing.
 */
export type AuthzFailureReason =
  | "unauthenticated" // no usable credential at all → 401
  | "forbidden" // authenticated, but not entitled to this workspace → 403
  | "workspace_required"; // authenticated, but no workspace was named → 400

export type WorkspaceAuthzResult =
  // The success variant spreads AuthorizedWorkspace so callers keep reading
  // `authz.access` / `authz.workspaceId` directly after the `ok` guard.
  | ({ ok: true } & AuthorizedWorkspace)
  | { ok: false; reason: AuthzFailureReason };

const FAILURE_RESPONSE: Record<
  AuthzFailureReason,
  { status: number; error: string; text: string }
> = {
  unauthenticated: { status: 401, error: "unauthorized", text: "Unauthorized" },
  forbidden: { status: 403, error: "forbidden", text: "Forbidden" },
  workspace_required: {
    status: 400,
    error: "workspace_required",
    text: "Workspace required",
  },
};

/**
 * The single mapping from an authorization failure to its HTTP response. Every
 * route funnels through this so the authn/authz distinction cannot drift back
 * apart one route at a time.
 */
export function authzErrorResponse(failure: {
  reason: AuthzFailureReason;
}): NextResponse {
  const { status, error } = FAILURE_RESPONSE[failure.reason];
  return NextResponse.json({ error }, { status });
}

/**
 * Plain-text variant for the browser-facing surfaces (artifact preview/source,
 * raw source redirects) whose callers are <img>/<iframe>/navigation rather than
 * JSON clients. Same status mapping, non-JSON body.
 */
export function authzErrorTextResponse(failure: {
  reason: AuthzFailureReason;
}): Response {
  const { status, text } = FAILURE_RESPONSE[failure.reason];
  return new Response(text, { status });
}

// Authorizes a request to act on a specific workspace. Accepts, in order:
//   1. an ApiToken Bearer (workspace-scoped; acts as a member with a single
//      grant on the token's folder scope)
//   2. a session-token Bearer (extension) for a member workspace
//   3. a Clerk cookie (web) for a member workspace
// Returns the workspace + an AccessContext, or a typed failure reason.
export async function authorizeWorkspaceRequest(
  req: Request,
  requestedWorkspaceId: string | undefined,
): Promise<WorkspaceAuthzResult> {
  const header = req.headers.get("authorization");

  const tokenAuthz = await authorizeApiToken(header);
  if (tokenAuthz) {
    // A valid token aimed at another workspace is authenticated but not
    // entitled — never widen it to the token's own workspace.
    if (
      requestedWorkspaceId &&
      requestedWorkspaceId !== tokenAuthz.workspaceId
    ) {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true, ...tokenAuthz };
  }

  // Resolve the caller before checking for a workspace: knowing *who* is asking
  // is what lets us tell "log in" apart from "name a workspace".
  const userId = await userIdFromRequest(req);
  if (!userId) return { ok: false, reason: "unauthenticated" };
  if (!requestedWorkspaceId) {
    return { ok: false, reason: "workspace_required" };
  }
  const access = await resolveAccess(userId, requestedWorkspaceId);
  // Non-member and non-existent collapse to the same 403: a workspace must not
  // reveal its existence to someone outside it.
  if (!access) return { ok: false, reason: "forbidden" };
  return { ok: true, workspaceId: requestedWorkspaceId, userId, access };
}
