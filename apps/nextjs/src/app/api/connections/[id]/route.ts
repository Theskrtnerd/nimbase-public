import { getConnectionForAccess } from "@acme/api/connection-control";
import { desc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { CrawlRun } from "@acme/db/schema";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { connectionControlErrorResponse } from "~/server/crawl/http";
import { invalidIdResponse, isUuidParam } from "~/server/http/params";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);

  try {
    const { id } = await params;
    if (!isUuidParam(id)) return invalidIdResponse();
    const connection = await getConnectionForAccess(authorized.access, id);
    const runs = await db
      .select()
      .from(CrawlRun)
      .where(eq(CrawlRun.connectionId, id))
      .orderBy(desc(CrawlRun.startedAt))
      .limit(10);
    return Response.json({ connection, runs });
  } catch (error) {
    const response = connectionControlErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
