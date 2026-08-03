import { NextResponse } from "next/server";
import { z } from "zod/v4";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact } from "@acme/db/schema";
import { artifactVisibilitySchema } from "@acme/validators/cli";

import { env } from "~/env";
import { loadArtifactScoped } from "~/server/artifact/load-artifact-scoped";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";

// set_artifact_access: change an artifact's share visibility. canManage-gated. The
// slug never changes once minted.
const Body = z.strictObject({
  workspaceId: z.uuid().optional(),
  visibility: artifactVisibilitySchema,
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: artifactRef } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const authz = await authorizeWorkspaceRequest(req, body.workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);

  const loaded = await loadArtifactScoped(artifactRef, authz.workspaceId);
  if (!loaded) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!authz.access.canManage(loaded.targetPath)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { artifact } = loaded;
  const { slug } = artifact;

  await db
    .update(Artifact)
    .set({
      visibility: body.visibility,
      slug,
      updatedAt: new Date(),
    })
    .where(eq(Artifact.id, artifact.id));

  return NextResponse.json({
    url: `${env.NIMBASE_WEB_URL}/s/${slug}`,
    id: artifact.id,
    slug,
    visibility: body.visibility,
  });
}
