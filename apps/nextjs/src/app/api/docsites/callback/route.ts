import { z } from "zod/v4";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { DocSite, DocSiteBuild } from "@acme/db/schema";

import { env } from "~/env";
import { verifyBuildCallback } from "~/server/docsite/runner";

export const runtime = "nodejs";

/**
 * Completion report from the external build runner.
 *
 * This is the only endpoint that can flip a site live, and the runner holds no
 * database credential — so the report is authenticated by an HMAC over the
 * build id, issued when the build was dispatched. Without it, anyone who
 * learned a build id could publish or fail a customer's site.
 */
const Body = z.object({
  buildId: z.uuid(),
  signature: z.string(),
  status: z.enum(["succeeded", "failed"]),
  log: z.string().max(20_000).optional(),
  error: z.string().max(2_000).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const secret = env.DOCS_BUILDER_CALLBACK_SECRET;
  if (!secret) {
    return Response.json({ error: "runner_not_configured" }, { status: 503 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const data = parsed.data;

  if (!verifyBuildCallback(data.buildId, data.signature, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const [build] = await db
    .select({
      id: DocSiteBuild.id,
      docSiteId: DocSiteBuild.docSiteId,
      status: DocSiteBuild.status,
      log: DocSiteBuild.log,
    })
    .from(DocSiteBuild)
    .where(eq(DocSiteBuild.id, data.buildId))
    .limit(1);
  if (!build) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  // A runner retry must not un-finish a build or re-flip an already-superseded
  // one; first report wins.
  if (build.status === "succeeded" || build.status === "failed") {
    return Response.json({ ok: true, duplicate: true });
  }

  const now = new Date();
  const log = [build.log, data.log].filter(Boolean).join("\n");

  if (data.status === "failed") {
    const error = data.error ?? "The docs build failed";
    await db
      .update(DocSiteBuild)
      .set({ status: "failed", error, log, finishedAt: now })
      .where(eq(DocSiteBuild.id, build.id));
    // Deliberately does NOT touch liveBuildId: a site that was already live
    // keeps serving its last good build through a failed rebuild.
    await db
      .update(DocSite)
      .set({ status: "failed", error })
      .where(eq(DocSite.id, build.docSiteId));
    return Response.json({ ok: true });
  }

  await db
    .update(DocSiteBuild)
    .set({ status: "succeeded", log, finishedAt: now })
    .where(eq(DocSiteBuild.id, build.id));
  // The atomic flip: assets were uploaded under this build's prefix before the
  // callback, so the site switches to the new content in one write.
  await db
    .update(DocSite)
    .set({
      status: "live",
      liveBuildId: build.id,
      error: null,
      lastBuiltAt: now,
    })
    .where(eq(DocSite.id, build.docSiteId));

  return Response.json({ ok: true });
}
