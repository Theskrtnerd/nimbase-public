import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { CrawlRun, SourceConnection, WikiNode } from "@acme/db/schema";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
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
  const { id } = await params;
  if (!isUuidParam(id)) return invalidIdResponse();
  const [row] = await db
    .select({ run: CrawlRun, folderPath: WikiNode.path })
    .from(CrawlRun)
    .innerJoin(SourceConnection, eq(SourceConnection.id, CrawlRun.connectionId))
    .leftJoin(
      WikiNode,
      and(
        eq(WikiNode.id, SourceConnection.targetFolderId),
        isNull(WikiNode.deletedAt),
      ),
    )
    .where(
      and(
        eq(CrawlRun.id, id),
        eq(CrawlRun.workspaceId, authorized.workspaceId),
      ),
    )
    .limit(1);
  if (!row || !authorized.access.canRead(row.folderPath ?? "")) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(row.run);
}
