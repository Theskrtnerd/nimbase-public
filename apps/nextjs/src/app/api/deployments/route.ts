import {
  createDeployment,
  DeploymentControlError,
  listDeploymentsForAccess,
} from "@acme/api/deployment-control";
import { EntitlementError } from "@acme/api/entitlements";
import { createDeploymentRequestSchema } from "@acme/validators/cli";

import { deploymentHttpResponse } from "~/server/agent/deployment-http";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (authorized.userId === null) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const deployments = await listDeploymentsForAccess(authorized.access);
  return Response.json({
    deployments: deployments.map((deployment) =>
      deploymentHttpResponse(request, deployment),
    ),
  });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = createDeploymentRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const authorized = await authorizeWorkspaceRequest(
    request,
    parsed.data.workspaceId,
  );
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (authorized.userId === null) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (parsed.data.platform === "slack") {
    return Response.json(
      {
        error:
          "The Slack adapter is not included in Community Edition. Install your own interface adapter or use Nimbase Cloud.",
      },
      { status: 501 },
    );
  }

  try {
    const deployment = await createDeployment({
      access: authorized.access,
      userId: authorized.userId,
      slug: parsed.data.slug,
      name: parsed.data.name,
      instructions: parsed.data.instructions,
      targetFolderId: parsed.data.targetFolderId,
      interface: {
        platform: "widget",
        config: {
          greeting: parsed.data.widget.greeting,
          allowedDomains: parsed.data.widget.allowedDomains,
          theme: {
            accent: parsed.data.widget.accent,
            position: parsed.data.widget.position,
          },
        },
      },
    });
    const { id: agentId, ...publicDeployment } = deployment;
    return Response.json(
      {
        agentId,
        deployment: deploymentHttpResponse(request, publicDeployment),
      },
      { status: 201 },
    );
  } catch (error) {
    return deploymentErrorResponse(error);
  }
}

function deploymentErrorResponse(error: unknown): Response {
  if (error instanceof EntitlementError) {
    return Response.json({ error: error.message }, { status: 402 });
  }
  if (error instanceof DeploymentControlError) {
    return Response.json(
      { error: error.message },
      {
        status:
          error.code === "conflict"
            ? 409
            : error.code === "invalid"
              ? 400
              : error.code === "forbidden"
                ? 403
                : 404,
      },
    );
  }
  throw error;
}
