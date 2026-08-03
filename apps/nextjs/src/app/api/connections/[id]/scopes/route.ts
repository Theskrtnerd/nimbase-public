import { z } from "zod/v4";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { connectionControlErrorResponse } from "~/server/crawl/http";
import {
  configureConnectionScopes,
  listConnectionScopes,
} from "~/server/crawl/scopes";
import { invalidIdResponse, isUuidParam } from "~/server/http/params";

export const runtime = "nodejs";

const ConfigureScopes = z.object({
  workspaceId: z.uuid(),
  scopeIds: z.array(z.string().min(1)).min(1).max(100),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (authorized.userId === null) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    if (!isUuidParam(id)) return invalidIdResponse();
    return Response.json(
      await listConnectionScopes({
        access: authorized.access,
        connectionId: id,
      }),
    );
  } catch (error) {
    const response = connectionControlErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ConfigureScopes.safeParse(
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

  try {
    const { id } = await params;
    if (!isUuidParam(id)) return invalidIdResponse();
    const scopes = await configureConnectionScopes({
      access: authorized.access,
      connectionId: id,
      scopeIds: parsed.data.scopeIds,
    });
    return Response.json(scopes);
  } catch (error) {
    const response = connectionControlErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
