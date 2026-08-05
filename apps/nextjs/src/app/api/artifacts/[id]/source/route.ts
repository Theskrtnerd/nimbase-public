import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact } from "@acme/db/schema";
import * as s3 from "@acme/runtime/s3";

import {
  authorizeWorkspaceRequest,
  authzErrorTextResponse,
} from "~/server/auth/authorize-workspace";
import { resolveTargetFolderPath } from "~/server/folders";
import { invalidIdTextResponse, isUuidParam } from "~/server/http/params";

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
      s3KeySource: Artifact.s3KeySource,
      targetFolderId: Artifact.targetFolderId,
    })
    .from(Artifact)
    .where(eq(Artifact.id, id))
    .limit(1);

  if (!artifact) return new Response("Not found", { status: 404 });

  const authorized = await authorizeWorkspaceRequest(req, artifact.workspaceId);
  if (!authorized.ok) return authzErrorTextResponse(authorized);

  // Confirm the artifact belongs to the authorized workspace.
  const [owned] = await db
    .select({ id: Artifact.id })
    .from(Artifact)
    .where(
      and(
        eq(Artifact.id, id),
        eq(Artifact.workspaceId, authorized.workspaceId),
      ),
    )
    .limit(1);
  if (!owned) return new Response("Forbidden", { status: 403 });

  // Visible iff the artifact's target space is readable. Resolve the folder path
  // ("" when null/deleted) and check read access. 404 (not 403) so an
  // unreadable artifact is indistinguishable from a nonexistent one.
  if (!authorized.access.isAdmin) {
    // Shared resolver: null id = root; a folder that resolves to nothing
    // returns null and denies. The inline query this replaced fell back to ""
    // (the widest prefix) for a soft-deleted folder and did not scope the
    // lookup to the workspace.
    const target = await resolveTargetFolderPath(
      artifact.workspaceId,
      artifact.targetFolderId,
    );
    if (!target || !authorized.access.canRead(target.path)) {
      return new Response("Not found", { status: 404 });
    }
  }

  // Only fixed-mode artifactes carry a TSX source; freeform has none.
  if (!artifact.s3KeySource) {
    return new Response("No source", { status: 404 });
  }

  const source = await s3.getObjectText(artifact.s3KeySource);
  return new Response(source, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
