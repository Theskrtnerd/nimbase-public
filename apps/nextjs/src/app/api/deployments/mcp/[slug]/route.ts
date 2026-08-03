import {
  deleteGroupMcpDeployment,
  getGroupMcpDeployment,
} from "@acme/api/deployment-surfaces-control";

import {
  authorizeAdminRequest,
  deploymentSurfaceErrorResponse,
  mcpDeploymentResponse,
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
    const row = await getGroupMcpDeployment(authorized.workspaceId, slug);
    return Response.json(
      await mcpDeploymentResponse(request, authorized.workspaceId, row),
    );
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
    await deleteGroupMcpDeployment(authorized.workspaceId, slug);
    return Response.json({ ok: true });
  } catch (error) {
    return deploymentSurfaceErrorResponse(error);
  }
}
