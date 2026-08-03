import {
  createGroupMcpDeployment,
  listGroupMcpDeployments,
} from "@acme/api/deployment-surfaces-control";
import { createGroupMcpRequestSchema } from "@acme/validators/cli";

import {
  authorizeAdminRequest,
  deploymentSurfaceErrorResponse,
  mcpDeploymentResponse,
} from "~/server/deployment-surfaces/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeAdminRequest(request, workspaceId);
  if (authorized instanceof Response) return authorized;

  const rows = await listGroupMcpDeployments(authorized.workspaceId);
  const deployments = await Promise.all(
    rows.map((row) =>
      mcpDeploymentResponse(request, authorized.workspaceId, row),
    ),
  );
  return Response.json({ deployments });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = createGroupMcpRequestSchema.safeParse(
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
    const row = await createGroupMcpDeployment(parsed.data);
    return Response.json(
      await mcpDeploymentResponse(request, authorized.workspaceId, row),
      { status: 201 },
    );
  } catch (error) {
    return deploymentSurfaceErrorResponse(error);
  }
}
