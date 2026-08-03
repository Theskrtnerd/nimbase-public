import { publishDocSiteDeployment } from "@acme/api/deployment-surfaces-control";
import { and, desc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { DocSite, DocSiteBuild } from "@acme/db/schema";

import {
  authorizeAdminRequest,
  deploymentSurfaceErrorResponse,
} from "~/server/deployment-surfaces/http";
import { docSiteBuildPort } from "~/server/docsite/dispatch";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const runtime = "nodejs";

/** Start a build. Returns the build id so `--wait` has something to poll. */
export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const authorized = await authorizeAdminRequest(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  const { slug } = await params;

  try {
    const result = await publishDocSiteDeployment(
      authorized.workspaceId,
      slug,
      docSiteBuildPort,
      authorized.userId,
    );
    return Response.json(result, { status: 202 });
  } catch (error) {
    return deploymentSurfaceErrorResponse(error);
  }
}

/** Poll one build's progress. */
export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const url = new URL(request.url);
  const authorized = await authorizeAdminRequest(
    request,
    url.searchParams.get("workspaceId") ?? undefined,
  );
  if (authorized instanceof Response) return authorized;
  const { slug } = await params;
  const buildId = url.searchParams.get("buildId");

  // Always scoped to this site AND this workspace: without the join, a bare
  // poll would return whichever build in the workspace started most recently,
  // which is the wrong site's status as soon as two sites publish at once.
  const [build] = await db
    .select({
      buildId: DocSiteBuild.id,
      status: DocSiteBuild.status,
      pageCount: DocSiteBuild.pageCount,
      log: DocSiteBuild.log,
      error: DocSiteBuild.error,
      finishedAt: DocSiteBuild.finishedAt,
    })
    .from(DocSiteBuild)
    .innerJoin(DocSite, eq(DocSite.id, DocSiteBuild.docSiteId))
    .where(
      and(
        eq(DocSiteBuild.workspaceId, authorized.workspaceId),
        eq(DocSite.slug, slug),
        ...(buildId ? [eq(DocSiteBuild.id, buildId)] : []),
      ),
    )
    .orderBy(desc(DocSiteBuild.startedAt))
    .limit(1);

  if (!build) {
    return Response.json({ error: "not_found", slug }, { status: 404 });
  }
  return Response.json({
    ...build,
    finishedAt: build.finishedAt?.toISOString() ?? null,
  });
}
