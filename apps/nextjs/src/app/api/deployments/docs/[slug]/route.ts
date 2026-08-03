import {
  deleteDocSiteDeployment,
  getDocSiteDeployment,
  workspaceSlug,
} from "@acme/api/deployment-surfaces-control";

import {
  authorizeAdminRequest,
  deploymentSurfaceErrorResponse,
  docSiteDeploymentResponse,
} from "~/server/deployment-surfaces/http";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeAdminRequest(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  const { slug } = await params;

  try {
    const [row, wsSlug] = await Promise.all([
      getDocSiteDeployment(authorized.workspaceId, slug),
      workspaceSlug(authorized.workspaceId),
    ]);
    return Response.json(docSiteDeploymentResponse(request, row, wsSlug));
  } catch (error) {
    return deploymentSurfaceErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeAdminRequest(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  const { slug } = await params;

  try {
    await deleteDocSiteDeployment(authorized.workspaceId, slug);
    return Response.json({ ok: true });
  } catch (error) {
    return deploymentSurfaceErrorResponse(error);
  }
}
