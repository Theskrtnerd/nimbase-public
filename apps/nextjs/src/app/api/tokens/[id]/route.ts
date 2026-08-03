import { NextResponse } from "next/server";

import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { ApiToken, WikiNode } from "@acme/db/schema";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { invalidIdResponse, isUuidParam } from "~/server/http/params";

export const runtime = "nodejs";

// DELETE /api/tokens/[id] — revoke a token. User session only; manage rights on
// the token's folder scope.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuidParam(id)) return invalidIdResponse();
  const workspaceId =
    new URL(req.url).searchParams.get("workspaceId") ?? undefined;

  const authz = await authorizeWorkspaceRequest(req, workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);
  if (authz.userId === null) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [token] = await db
    .select({ id: ApiToken.id, folderId: ApiToken.folderId })
    .from(ApiToken)
    .where(
      and(eq(ApiToken.id, id), eq(ApiToken.workspaceId, authz.workspaceId)),
    )
    .limit(1);
  if (!token) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let scopePath = "";
  if (token.folderId) {
    const [folder] = await db
      .select({ path: WikiNode.path })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.id, token.folderId),
          eq(WikiNode.workspaceId, authz.workspaceId),
          isNull(WikiNode.deletedAt),
        ),
      )
      .limit(1);
    scopePath = folder?.path ?? "";
  }
  if (!authz.access.canManage(scopePath)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.delete(ApiToken).where(eq(ApiToken.id, token.id));
  return NextResponse.json({ ok: true });
}
