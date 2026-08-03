import {
  createDocSiteDeployment,
  listDocSiteDeployments,
  workspaceSlug,
} from "@acme/api/deployment-surfaces-control";
import { createDocSiteRequestSchema } from "@acme/validators/cli";

import {
  authorizeAdminRequest,
  deploymentSurfaceErrorResponse,
  docSiteDeploymentResponse,
} from "~/server/deployment-surfaces/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeAdminRequest(request, workspaceId);
  if (authorized instanceof Response) return authorized;

  const [rows, slug] = await Promise.all([
    listDocSiteDeployments(authorized.workspaceId),
    workspaceSlug(authorized.workspaceId),
  ]);
  return Response.json({
    deployments: rows.map((row) =>
      docSiteDeploymentResponse(request, row, slug),
    ),
  });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = createDocSiteRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const authorized = await authorizeAdminRequest(
    request,
    parsed.data.workspaceId,
  );
  if (authorized instanceof Response) return authorized;

  try {
    const [row, slug] = await Promise.all([
      createDocSiteDeployment({ ...parsed.data, userId: authorized.userId }),
      workspaceSlug(authorized.workspaceId),
    ]);
    return Response.json(docSiteDeploymentResponse(request, row, slug), {
      status: 201,
    });
  } catch (error) {
    return deploymentSurfaceErrorResponse(error);
  }
}
