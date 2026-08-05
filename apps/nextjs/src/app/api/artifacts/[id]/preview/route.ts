import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact } from "@acme/db/schema";
import * as s3 from "@acme/runtime/s3";

import {
  authorizeWorkspaceRequest,
  authzErrorTextResponse,
} from "~/server/auth/authorize-workspace";
import { resolveTargetFolderPath } from "~/server/folders";
import { invalidIdTextResponse, isUuidParam } from "~/server/http/params";
import { serveShareHtml } from "~/server/share/serve-share-html";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuidParam(id)) return invalidIdTextResponse();

  const [artifact] = await db
    .select({
      workspaceId: Artifact.workspaceId,
      s3KeyHtml: Artifact.s3KeyHtml,
      targetFolderId: Artifact.targetFolderId,
    })
    .from(Artifact)
    .where(eq(Artifact.id, id))
    .limit(1);

  if (!artifact) return new Response("Not found", { status: 404 });

  const authorized = await authorizeWorkspaceRequest(req, artifact.workspaceId);
  if (!authorized.ok) return authzErrorTextResponse(authorized);
  // The artifact must belong to the authorized workspace (we already hold both).
  if (artifact.workspaceId !== authorized.workspaceId) {
    return new Response("Forbidden", { status: 403 });
  }

  // Visible iff the artifact's target space is readable. A missing/soft-deleted
  // folder falls back to root "" (resolveTargetFolderPath → null → ""). 404
  // (not 403) so an unreadable artifact is indistinguishable from a nonexistent
  // one.
  if (!authorized.access.isAdmin) {
    const target = await resolveTargetFolderPath(
      artifact.workspaceId,
      artifact.targetFolderId,
    );
    if (!authorized.access.canRead(target?.path ?? "")) {
      return new Response("Not found", { status: 404 });
    }
  }

  // A artifact that has never finished generating has no artifact yet.
  if (!artifact.s3KeyHtml) return new Response("Not ready", { status: 404 });

  const html = await s3.getObjectText(artifact.s3KeyHtml);
  const response = serveShareHtml(html, {
    runtimeOrigin: new URL(req.url).origin,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
