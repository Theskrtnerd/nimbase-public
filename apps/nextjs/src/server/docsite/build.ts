import "server-only";

import type { DocSiteBuildJobData } from "@acme/cloud";
import { curateDocsContent } from "@acme/cloud/docs/curate";
import { projectDocsContent, renderDocPage } from "@acme/cloud/docs/project";
import { putObject, s3KeyFor } from "@acme/cloud/s3";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { DocSite, DocSiteBuild, SpendLedger, Workspace } from "@acme/db/schema";

import { env } from "~/env";
import { docSiteBasePath } from "~/lib/doc-site-url";
import { resolveDocSiteFence } from "./fence";
import { loadFencedPages } from "./load-pages";
import { dispatchToRunner, runnerConfigured } from "./runner";

/**
 * Project a docs site's memory slice and hand it to the build runner.
 *
 * This job owns everything up to (and not including) `astro build`. It ends by
 * moving the build to `building` and firing the runner; the runner reports back
 * to `/api/docsites/callback`, which is what finally flips the site live.
 *
 * The fence is resolved here from the site's folder — never from the payload
 * — so no caller can influence what a published site contains.
 */
export async function processDocSiteBuildJob(
  data: DocSiteBuildJobData,
): Promise<void> {
  const fail = async (message: string): Promise<never> => {
    await db
      .update(DocSiteBuild)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(DocSiteBuild.id, data.buildId));
    await db
      .update(DocSite)
      .set({ status: "failed", error: message })
      .where(eq(DocSite.id, data.docSiteId));
    throw new Error(message);
  };

  const [site] = await db
    .select({
      id: DocSite.id,
      slug: DocSite.slug,
      name: DocSite.name,
      folderId: DocSite.folderId,
      config: DocSite.config,
      templateVersion: DocSite.templateVersion,
      visibility: DocSite.visibility,
      workspaceSlug: Workspace.slug,
    })
    .from(DocSite)
    .innerJoin(Workspace, eq(Workspace.id, DocSite.workspaceId))
    .where(
      and(
        eq(DocSite.id, data.docSiteId),
        eq(DocSite.workspaceId, data.workspaceId),
      ),
    )
    .limit(1);
  if (!site) return fail("Docs site not found");

  if (!runnerConfigured()) {
    // Say which knob is missing rather than dying inside a fetch. Publishing is
    // the only part of the feature that needs the runner.
    return fail("The docs build runner is not configured");
  }

  await db
    .update(DocSiteBuild)
    .set({ status: "projecting" })
    .where(eq(DocSiteBuild.id, data.buildId));

  const fence = await resolveDocSiteFence(data.workspaceId, site.folderId);
  if (fence.scopes.length === 0) {
    // Fail closed, loudly. An empty fence means the deployment folder is
    // gone; publishing "nothing" would look like a working build.
    return fail(
      "This site's memory folder is missing, so nothing could be published",
    );
  }

  const loaded = await loadFencedPages(data.workspaceId, fence.scopes);
  const projected = projectDocsContent(loaded.pages, {
    fencePrefix: fence.prefix,
    siteTitle: site.name,
  });
  if (projected.pageCount === 0) {
    return fail("No memory in this folder yet, so there is nothing to publish");
  }

  const curated = await curateDocsContent({
    workspaceId: data.workspaceId,
    siteTitle: site.name,
    guidance:
      site.config?.instructions ?? "Publish clear, accurate documentation.",
    pages: projected.pages,
  });
  if (curated.costCents > 0) {
    await db.insert(SpendLedger).values({
      workspaceId: data.workspaceId,
      kind: "docsite",
      cents: curated.costCents,
    });
  }

  const inputKey = s3KeyFor.docSiteInput(data.workspaceId, data.buildId);
  await putObject(
    inputKey,
    JSON.stringify({
      site: {
        title: site.name,
        description: site.config?.description ?? "",
        locale: site.config?.locale ?? "en",
        // Astro bakes origin+base into canonical URLs, the sitemap, OG tags,
        // and the links in /llms.txt. Both must match where the site is really
        // served — a placeholder here produces a site whose every canonical
        // link points somewhere wrong.
        origin: `https://${env.NIMBASE_DOCS_HOST ?? "docs.nimbase.ai"}`,
        // Astro's `base`. Nimbus itself is base-unaware, so the builder repo's
        // starter carries a withBase() patch that applies this to nav links.
        base: `${docSiteBasePath(site.workspaceSlug, site.slug)}/`,
      },
      // Serialized exactly once, here, at the boundary that writes the bundle.
      files: curated.pages.map(renderDocPage),
    }),
    "application/json",
  );

  await db
    .update(DocSiteBuild)
    .set({
      status: "building",
      pageCount: projected.pageCount,
      log: buildNotes(projected.skipped, loaded, curated.degraded),
    })
    .where(eq(DocSiteBuild.id, data.buildId));

  try {
    await dispatchToRunner({
      buildId: data.buildId,
      workspaceId: data.workspaceId,
      inputKey,
      templateVersion: site.templateVersion,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Build dispatch failed");
  }
}

/**
 * Everything the operator needs to explain a surprising site, recorded whether
 * or not the build succeeds. Silent truncation is the failure mode worth
 * guarding against: a short site reads as "that's all there is".
 */
function buildNotes(
  skipped: { path: string; reason: string }[],
  loaded: { truncated: boolean; unreadable: string[] },
  degraded: string | null,
): string {
  const notes: string[] = [];
  if (loaded.truncated) {
    notes.push("Page cap reached — some memory was not published.");
  }
  if (loaded.unreadable.length > 0) {
    notes.push(`Unreadable bodies skipped: ${loaded.unreadable.join(", ")}`);
  }
  for (const entry of skipped) {
    notes.push(`Skipped ${entry.path}: ${entry.reason}`);
  }
  if (degraded) notes.push(`Curation degraded: ${degraded}`);
  return notes.join("\n");
}
