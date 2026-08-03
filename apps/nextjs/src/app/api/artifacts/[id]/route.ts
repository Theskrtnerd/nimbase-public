import { NextResponse } from "next/server";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact } from "@acme/db/schema";

import { loadArtifactScoped } from "~/server/artifact/load-artifact-scoped";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";

// DELETE /api/artifacts/[ref] — mirrors artifactRouter.delete for the CLI's
// Bearer credential paths. Manage rights on the artifact's target folder, and
// not-found for anything the caller cannot read, so an artifact outside their
// scopes never reveals its existence.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: artifactRef } = await params;
  const workspaceId =
    new URL(req.url).searchParams.get("workspaceId") ?? undefined;

  const authz = await authorizeWorkspaceRequest(req, workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);

  const loaded = await loadArtifactScoped(artifactRef, authz.workspaceId);
  if (!loaded || !authz.access.canRead(loaded.targetPath)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Readable but not manageable is a real 403: the caller already knows the
  // artifact exists, so hiding it again would only be confusing.
  if (!authz.access.canManage(loaded.targetPath)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.delete(Artifact).where(eq(Artifact.id, loaded.artifact.id));
  return NextResponse.json({
    ok: true,
    id: loaded.artifact.id,
    slug: loaded.artifact.slug,
  });
}
