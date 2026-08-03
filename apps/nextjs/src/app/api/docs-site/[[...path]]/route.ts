import { auth } from "@clerk/nextjs/server";

import { resolveAccess } from "@acme/api/access";
import { getObjectBytes, s3KeyFor } from "@acme/cloud/s3";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { DocSite, WikiNode, Workspace } from "@acme/db/schema";

import { docSiteBasePath } from "~/lib/doc-site-url";
import { contentTypeFor, resolveAssetPath } from "~/server/docsite/assets";

export const runtime = "nodejs";

/**
 * Serves a published documentation site from S3.
 *
 * Reached by a host rewrite from `docs.<appHost>/<workspace>/<site>/...`
 * (see next.config.js). We serve these ourselves rather than pointing a CDN at
 * the bucket because a `private` site's fence is ours to enforce — a static
 * origin has no way to ask whether this reader may see this memory folder.
 *
 * Only `liveBuildId` is ever served, so a site in the middle of a failed
 * rebuild keeps serving its last good build.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  const [workspaceSlug, siteSlug, ...rest] = path;
  if (!workspaceSlug || !siteSlug) return notFound();

  const [site] = await db
    .select({
      workspaceId: DocSite.workspaceId,
      liveBuildId: DocSite.liveBuildId,
      visibility: DocSite.visibility,
      folderId: DocSite.folderId,
      folderPath: WikiNode.path,
    })
    .from(DocSite)
    .innerJoin(Workspace, eq(Workspace.id, DocSite.workspaceId))
    .leftJoin(WikiNode, eq(WikiNode.id, DocSite.folderId))
    .where(and(eq(Workspace.slug, workspaceSlug), eq(DocSite.slug, siteSlug)))
    .limit(1);

  // A site that exists but has never built is indistinguishable from one that
  // doesn't — an unpublished site should not advertise itself.
  if (!site?.liveBuildId) return notFound();

  if (site.visibility === "private") {
    const allowed = await canReadPrivateSite(
      site.workspaceId,
      site.folderId ? site.folderPath : "",
    );
    // 404, not 403: a private site's existence is itself information.
    if (!allowed) return notFound();
  }

  // Assert the path we were reached at is the one the build was based on. The
  // Astro `base` baked into every asset and nav link comes from this same
  // helper, so a divergence here is what "site loads, every link 404s" looks
  // like — better to fail loudly than to serve a subtly broken site.
  const expected = docSiteBasePath(workspaceSlug, siteSlug);
  if (`/${workspaceSlug}/${siteSlug}` !== expected) return notFound();

  const assetPath = resolveAssetPath(rest);
  const key = s3KeyFor.docSiteAsset(
    site.workspaceId,
    site.liveBuildId,
    assetPath,
  );

  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(key);
  } catch {
    return notFound();
  }
  if (bytes.length === 0) return notFound();

  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": contentTypeFor(assetPath),
      // Public sites are CDN-cacheable; a private one must never be stored by
      // a shared cache, or the fence stops meaning anything after the first hit.
      "cache-control":
        site.visibility === "public"
          ? "public, max-age=0, s-maxage=300, stale-while-revalidate=86400"
          : "private, no-store",
      // The site is static HTML from our own build; nothing here should ever be
      // framed or sniffed into something executable.
      "x-content-type-options": "nosniff",
    },
  });
}

async function canReadPrivateSite(
  workspaceId: string,
  folderPath: string | null,
): Promise<boolean> {
  // Null means a configured folder is missing. Empty string deliberately
  // means the centralized KB root.
  if (folderPath === null) return false;
  const { userId } = await auth();
  if (!userId) return false;
  const access = await resolveAccess(userId, workspaceId);
  return access?.canRead(folderPath) ?? false;
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
