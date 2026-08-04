import "server-only";

import {
  DeploymentSurfaceError,
  workspaceSlug,
} from "@acme/api/deployment-surfaces-control";
import { EntitlementError } from "@acme/api/entitlements";

import type { AuthorizedWorkspace } from "~/server/auth/authorize-workspace";
import { env } from "~/env";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export type AuthorizedAdmin = AuthorizedWorkspace & { userId: string };

export async function authorizeAdminRequest(
  request: Request,
  workspaceId: string | undefined,
): Promise<AuthorizedAdmin | Response> {
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (authorized.userId === null || !authorized.access.isAdmin) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return { ...authorized, userId: authorized.userId };
}

export function deploymentSurfaceErrorResponse(error: unknown): Response {
  if (error instanceof EntitlementError) {
    return Response.json({ error: error.message }, { status: 402 });
  }
  if (error instanceof DeploymentSurfaceError) {
    const status =
      error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
    return Response.json({ error: error.message }, { status });
  }
  throw error;
}

export async function mcpDeploymentResponse(
  request: Request,
  workspaceId: string,
  deployment: {
    slug: string;
    name: string;
    instructions: string;
    folderPath: string;
    enabled: boolean;
    tools: (
      | "search"
      | "get_note"
      | "list_sources"
      | "capture"
      | "create_artifact"
    )[];
  },
) {
  const orgSlug = await workspaceSlug(workspaceId);
  return {
    ...deployment,
    authMethods: ["oauth"] as const,
    url: groupMcpUrl(request, orgSlug, deployment.slug),
  };
}

function groupMcpUrl(
  request: Request,
  orgSlug: string,
  groupSlug: string,
): string {
  const requestUrl = new URL(request.url);
  if (
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1"
  ) {
    return `${requestUrl.origin}/api/group-mcp/${encodeURIComponent(orgSlug)}/${encodeURIComponent(groupSlug)}`;
  }
  const appHost = env.NEXT_PUBLIC_APP_HOST ?? "nimbase.ai";
  return `https://mcp.${appHost}/${encodeURIComponent(orgSlug)}/${encodeURIComponent(groupSlug)}/mcp`;
}
