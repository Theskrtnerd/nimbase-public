import type { WorkspaceModelConfig } from "@acme/validators/cli";
import {
  getWorkspaceAiConfig,
  updateWorkspaceAiConfig,
  WorkspaceAiConfigError,
  workspaceChatModelOptions,
} from "@acme/api/workspace-ai-config";
import { workspaceModelUpdateSchema } from "@acme/validators/cli";

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
  if (authorized.userId === null || !authorized.access.isAdmin) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return Response.json(
    workspaceModelResponse(await getWorkspaceAiConfig(authorized.workspaceId)),
  );
}

export async function PATCH(request: Request): Promise<Response> {
  const parsed = workspaceModelUpdateSchema.safeParse(
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
  if (authorized.userId === null || !authorized.access.isAdmin) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await updateWorkspaceAiConfig(authorized.workspaceId, {
      chatModel: parsed.data.modelId,
    });
    return Response.json(
      workspaceModelResponse(
        await getWorkspaceAiConfig(authorized.workspaceId),
      ),
    );
  } catch (error) {
    if (error instanceof WorkspaceAiConfigError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

function workspaceModelResponse(
  config: Awaited<ReturnType<typeof getWorkspaceAiConfig>>,
): WorkspaceModelConfig {
  const workspaceOverride = config.override.chatModel;
  return {
    modelId: workspaceOverride ?? config.inherited.chatModel,
    workspaceOverride,
    source: workspaceOverride === null ? "global" : "workspace",
    availableModels: workspaceChatModelOptions(),
  };
}
