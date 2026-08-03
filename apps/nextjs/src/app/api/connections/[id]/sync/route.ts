import { requireSyncableConnection } from "@acme/api/connection-control";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { connectionControlErrorResponse } from "~/server/crawl/http";
import { crawlPort } from "~/server/crawl/port";
import { invalidIdResponse, isUuidParam } from "~/server/http/params";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: unknown;
  } | null;
  const workspaceId =
    typeof body?.workspaceId === "string" ? body.workspaceId : undefined;
  if (!workspaceId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (authorized.userId === null) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    if (!isUuidParam(id)) return invalidIdResponse();
    await requireSyncableConnection(authorized.access, id);
    const { runId } = await crawlPort.enqueue({
      connectionId: id,
      workspaceId: authorized.workspaceId,
    });
    return Response.json({ runId, connectionId: id }, { status: 202 });
  } catch (error) {
    const response = connectionControlErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
