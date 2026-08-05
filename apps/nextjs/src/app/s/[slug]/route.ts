import { auth } from "@clerk/nextjs/server";

import { resolveAccess } from "@acme/api/access";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact, WikiNode } from "@acme/db/schema";
import * as s3 from "@acme/runtime/s3";

import { decideShareAccess } from "~/server/share/access-decision";
import { buildingPage } from "~/server/share/building-page";
import {
  ARTIFACT_ROBOTS_POLICY,
  serveShareHtml,
} from "~/server/share/serve-share-html";
import { shareUrl } from "~/server/share/share-url";

export const runtime = "nodejs";

async function artifactTargetPath(
  workspaceId: string,
  targetFolderId: string | null,
): Promise<string> {
  if (!targetFolderId) return "";
  const [folder] = await db
    .select({ path: WikiNode.path })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.id, targetFolderId),
        eq(WikiNode.workspaceId, workspaceId),
        isNull(WikiNode.deletedAt),
      ),
    )
    .limit(1);
  return folder?.path ?? "";
}

async function isArtifactReader(
  workspaceId: string,
  targetFolderId: string | null,
): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const access = await resolveAccess(userId, workspaceId);
  if (!access) return false;
  return access.canRead(await artifactTargetPath(workspaceId, targetFolderId));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const [artifact] = await db
    .select()
    .from(Artifact)
    .where(eq(Artifact.slug, slug))
    .limit(1);

  if (artifact) {
    // A generation that failed, or finished without an artifact, will never
    // have anything to serve → indistinguishable from missing.
    if (
      artifact.status === "failed" ||
      (artifact.status === "draft" && !artifact.s3KeyHtml)
    ) {
      return new Response("Not found", { status: 404 });
    }
    if (artifact.expiresAt && artifact.expiresAt.getTime() < Date.now()) {
      return new Response("Gone", { status: 410 });
    }

    const isReader = await isArtifactReader(
      artifact.workspaceId,
      artifact.targetFolderId,
    );
    const decision = decideShareAccess({
      visibility: artifact.visibility,
      isReader,
    });
    if (decision === "forbidden") {
      return new Response("Not found", { status: 404 });
    }
    // Still generating. Reached only *after* the same gate a finished artifact
    // passes, so waiting reveals nothing a reader couldn't already open — and
    // no OG meta, since there is no content to describe yet.
    if (artifact.status !== "draft" || !artifact.s3KeyHtml) {
      return new Response(buildingPage(), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-robots-tag": ARTIFACT_ROBOTS_POLICY,
        },
      });
    }
    return serveShareHtml(await s3.getObjectText(artifact.s3KeyHtml), {
      runtimeOrigin: new URL(req.url).origin,
      meta: {
        title: artifact.title,
        description: artifact.prompt,
        url: shareUrl(slug),
      },
    });
  }

  return new Response("Not found", { status: 404 });
}
