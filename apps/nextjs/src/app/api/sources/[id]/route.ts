import { targetFolderReadFilter } from "@acme/api/access";
import { providerAccessFilter } from "@acme/api/provider-access";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { Source, WikiNode } from "@acme/db/schema";

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
  const { targetPath, scopeFilter } = targetFolderReadFilter(authorized.access);
  const [source] = await db
    .select({
      id: Source.id,
      kind: Source.kind,
      sourceUrl: Source.sourceUrl,
      title: Source.title,
      originalFilename: Source.originalFilename,
      status: Source.status,
      error: Source.error,
      compileReport: Source.compileReport,
      metadata: Source.metadata,
      capturedAt: Source.capturedAt,
      createdAt: Source.createdAt,
      compiledAt: Source.compiledAt,
      capturedByName: Source.capturedByName,
      targetPath,
      connectionId: Source.connectionId,
      externalId: Source.externalId,
    })
    .from(Source)
    .leftJoin(
      WikiNode,
      and(eq(WikiNode.id, Source.targetFolderId), isNull(WikiNode.deletedAt)),
    )
    .where(
      and(
        eq(Source.id, id),
        eq(Source.workspaceId, authorized.workspaceId),
        scopeFilter,
        providerAccessFilter(authorized.access, Source.accessPolicyId),
      ),
    )
    .limit(1);
  if (!source) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(source);
}
