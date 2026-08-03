import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { workspaceStatus } from "~/server/status/workspace-status";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);
  const status = await workspaceStatus(authorized.access);
  if (!status) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(status);
}
