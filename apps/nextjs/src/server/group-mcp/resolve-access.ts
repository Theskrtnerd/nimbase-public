import "server-only";

import type { AccessContext } from "@acme/api/access";
import type {
  ArtifactVisibility,
  GroupMcpTool,
  McpAuthMethod,
} from "@acme/db/schema";
import { anchoredContext, resolveAccess } from "@acme/api/access";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import {
  GroupMcp,
  groupMcpNeedsWriteRole,
  WikiNode,
  Workspace,
} from "@acme/db/schema";

import { authorizeApiToken } from "~/server/auth/authorize-workspace";

export interface GroupMcpEndpoint {
  workspaceId: string;
  deploymentId: string;
  folderId: string | null;
  folderPath: string;
  tools: GroupMcpTool[];
  authMethods: McpAuthMethod[];
  // Exposure of artifacts this endpoint authors — admin config, never chosen by
  // a tool call. Only meaningful when "create_artifact" is in `tools`.
  artifactVisibility: ArtifactVisibility;
}

export type GroupMcpAuthResult =
  | { ok: true; endpoint: GroupMcpEndpoint; access: AccessContext }
  // 404 is never produced by resolveGroupMcpAccess itself — it's the
  // caller's response when loadGroupMcpEndpoint resolves to null (no such
  // endpoint, or the endpoint isn't MCP-enabled).
  | { ok: false; status: 401 | 403 | 404 };

// Resolve org-slug + group-slug to a live, MCP-enabled endpoint (or null).
export async function loadGroupMcpEndpoint(
  orgSlug: string,
  groupSlug: string,
): Promise<GroupMcpEndpoint | null> {
  const rows = await db
    .select({
      workspaceId: Workspace.id,
      deploymentId: GroupMcp.id,
      folderId: GroupMcp.folderId,
      folderPath: WikiNode.path,
      enabled: GroupMcp.enabled,
      tools: GroupMcp.tools,
      authMethods: GroupMcp.authMethods,
      artifactVisibility: GroupMcp.artifactVisibility,
    })
    .from(Workspace)
    .innerJoin(GroupMcp, eq(GroupMcp.workspaceId, Workspace.id))
    .leftJoin(
      WikiNode,
      and(eq(WikiNode.id, GroupMcp.folderId), isNull(WikiNode.deletedAt)),
    )
    .where(and(eq(Workspace.slug, orgSlug), eq(GroupMcp.slug, groupSlug)))
    .limit(1);

  const row = rows[0];
  if (!row?.enabled) return null;
  if (row.folderId && !row.folderPath) return null;
  return {
    workspaceId: row.workspaceId,
    deploymentId: row.deploymentId,
    folderId: row.folderId,
    folderPath: row.folderPath ?? "",
    tools: row.tools,
    authMethods: row.authMethods,
    artifactVisibility: row.artifactVisibility,
  };
}

// Build a fresh AccessContext whose single grant fences to the deployment
// folder.
function fencedContext(
  workspaceId: string,
  userId: string | null,
  userProfileId: string | null,
  folderPath: string,
  role: "viewer" | "contributor",
  restricted: string[],
): AccessContext {
  return anchoredContext({
    workspaceId,
    userId,
    userProfileId,
    folderPath,
    role,
    restricted,
  });
}

export async function resolveGroupMcpAccess(args: {
  endpoint: GroupMcpEndpoint;
  authorizationHeader: string | null;
  clerkUserId: string | null;
}): Promise<GroupMcpAuthResult> {
  const { endpoint, authorizationHeader, clerkUserId } = args;
  const wantsWrite = groupMcpNeedsWriteRole(endpoint.tools);

  // 1. API key path (if allowed and a bearer token was presented). A Clerk
  //    OAuth token also arrives as a Bearer header, so a token that isn't a
  //    valid ApiToken must fall through to the OAuth path below, not 401 here.
  if (
    authorizationHeader?.startsWith("Bearer ") &&
    endpoint.authMethods.includes("api_key")
  ) {
    const authz = await authorizeApiToken(authorizationHeader);
    if (authz) {
      if (
        authz.access.workspaceId !== endpoint.workspaceId ||
        authz.apiToken?.groupMcpId !== endpoint.deploymentId
      ) {
        return { ok: false, status: 403 };
      }
      // The token must be able to read the endpoint's folder. The RETURNED
      // access is always fenced to that folder below — regardless of how
      // much broader the token's own scope is (e.g. a token scoped to a
      // parent folder can read this folder but must not leak sibling
      // folders through this endpoint).
      if (!authz.access.canRead(endpoint.folderPath)) {
        return { ok: false, status: 403 };
      }
      // Down-scope to the folder, same as the OAuth path below.
      const role =
        wantsWrite && authz.access.canCapture(endpoint.folderPath)
          ? "contributor"
          : "viewer";
      const access = fencedContext(
        endpoint.workspaceId,
        authz.userId,
        authz.access.userProfileId,
        endpoint.folderPath,
        role,
        authz.access.restricted,
      );
      return { ok: true, endpoint, access };
    }
  }

  // 2. OAuth member path (if allowed and Clerk resolved a user).
  if (clerkUserId && endpoint.authMethods.includes("oauth")) {
    const member = await resolveAccess(clerkUserId, endpoint.workspaceId);
    if (!member) return { ok: false, status: 403 };
    if (!member.canRead(endpoint.folderPath)) return { ok: false, status: 403 };
    // Down-scope to the folder. Grant contributor only if the endpoint exposes
    // a write tool AND the member may capture there; otherwise viewer.
    const role =
      wantsWrite && member.canCapture(endpoint.folderPath)
        ? "contributor"
        : "viewer";
    const access = fencedContext(
      endpoint.workspaceId,
      clerkUserId,
      member.userProfileId,
      endpoint.folderPath,
      role,
      member.restricted,
    );
    return { ok: true, endpoint, access };
  }

  // 3. A credential was presented but its method is disabled, or none at all.
  if (authorizationHeader || clerkUserId) return { ok: false, status: 403 };
  return { ok: false, status: 401 };
}
