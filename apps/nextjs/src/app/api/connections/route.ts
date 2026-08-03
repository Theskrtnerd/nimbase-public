import { jsonValueSchema } from "@nimbase/connector-sdk";
import { z } from "zod/v4";

import { listConnectionsForAccess } from "@acme/api/connection-control";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { crawlPort } from "~/server/crawl/port";
import { registerRemoteConnector } from "~/server/crawl/register";
import { resolveTargetFolderPath } from "~/server/folders";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);

  const providers = crawlPort.providers();
  const connections = await listConnectionsForAccess(authorized.access);
  return Response.json({ connections, providers });
}

const registerConnectorSchema = z.object({
  workspaceId: z.uuid(),
  endpointUrl: z.url(),
  secret: z.string().min(1).max(10_000).nullable().default(null),
  displayName: z.string().trim().min(1).max(200).nullable().default(null),
  targetFolderId: z.uuid().nullable().default(null),
  intervalSeconds: z.number().int().min(300).max(2_592_000).default(86_400),
  configuration: z.record(z.string(), jsonValueSchema).default({}),
});

export async function POST(request: Request): Promise<Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = registerConnectorSchema.safeParse(value);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const authorized = await authorizeWorkspaceRequest(
    request,
    parsed.data.workspaceId,
  );
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (!authorized.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const target = await resolveTargetFolderPath(
    authorized.workspaceId,
    parsed.data.targetFolderId,
  );
  if (!target) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!authorized.access.canManage(target.path)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await registerRemoteConnector({
      workspaceId: authorized.workspaceId,
      userId: authorized.userId,
      targetFolderId: parsed.data.targetFolderId,
      endpointUrl: parsed.data.endpointUrl,
      secret: parsed.data.secret,
      displayName: parsed.data.displayName,
      intervalSeconds: parsed.data.intervalSeconds,
      configuration: parsed.data.configuration,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error(
      "[connections.register] connector registration failed",
      error,
    );
    return Response.json({ error: "connector_unavailable" }, { status: 502 });
  }
}
