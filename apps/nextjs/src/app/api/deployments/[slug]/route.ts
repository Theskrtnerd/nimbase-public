import {
  deleteDeployment,
  DeploymentControlError,
  getDeploymentForAccess,
} from "@acme/api/deployment-control";

import { deploymentHttpResponse } from "~/server/agent/deployment-http";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (authorized.userId === null) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { slug } = await params;
    const deployment = await getDeploymentForAccess(authorized.access, slug);
    return Response.json(deploymentHttpResponse(request, deployment));
  } catch (error) {
    return deploymentErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (authorized.userId === null) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { slug } = await params;
    await deleteDeployment({ access: authorized.access, slug });
    return Response.json({ ok: true, slug });
  } catch (error) {
    return deploymentErrorResponse(error);
  }
}

function deploymentErrorResponse(error: unknown): Response {
  if (error instanceof DeploymentControlError) {
    return Response.json(
      { error: error.message },
      { status: error.code === "forbidden" ? 403 : 404 },
    );
  }
  throw error;
}
