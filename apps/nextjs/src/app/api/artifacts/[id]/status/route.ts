import { NextResponse } from "next/server";

import { env } from "~/env";
import { loadArtifactScoped } from "~/server/artifact/load-artifact-scoped";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";

// get_artifact: generation status for polling. canRead-gated on the artifact's
// target folder.
export async function GET(
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

  const { artifact } = loaded;
  const url = `${env.NIMBASE_WEB_URL}/s/${artifact.slug}`;
  return NextResponse.json({
    id: artifact.id,
    slug: artifact.slug,
    status: artifact.status,
    ready: artifact.status === "draft" && !!artifact.s3KeyHtml,
    url,
    visibility: artifact.visibility,
    error: artifact.error,
  });
}
