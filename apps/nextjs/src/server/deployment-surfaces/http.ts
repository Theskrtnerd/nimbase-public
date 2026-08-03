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
// Relative, not `~/lib/...`: vitest has no `~` alias, and this module is
// imported transitively by a test — an aliased import here fails to resolve.
import { docSiteUrl } from "../../lib/doc-site-url";

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

export function docSiteDeploymentResponse(
  request: Request,
  deployment: {
    slug: string;
    name: string;
    folderPath: string;
    visibility: "private" | "public";
    status: "draft" | "building" | "live" | "failed";
    templateVersion: string;
    lastBuiltAt: Date | null;
    error: string | null;
  },
  workspaceSlug: string,
) {
  const { lastBuiltAt, ...rest } = deployment;
  return {
    ...rest,
    url: docSiteUrlFrom(request, workspaceSlug, deployment.slug),
    lastBuiltAt: lastBuiltAt?.toISOString() ?? null,
  };
}

// Thin request adapter over the canonical docSiteUrl: it only decides which
// host the caller should be told about. Dev has no docs host, so the URL points
// at the route directly — otherwise a local `deploy docs get` prints an address
// that cannot resolve.
function docSiteUrlFrom(
  request: Request,
  workspaceSlug: string,
  siteSlug: string,
): string {
  const url = new URL(request.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return docSiteUrl({
    workspaceSlug,
    siteSlug,
    docsHost: isLocal
      ? undefined
      : (env.NIMBASE_DOCS_HOST ?? `docs.${url.hostname.replace(/^app\./, "")}`),
    devOrigin: url.origin,
  });
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
