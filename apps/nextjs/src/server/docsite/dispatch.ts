import "server-only";

import { randomUUID } from "node:crypto";

import type { DocSiteBuildPort } from "@acme/api/deployment-surfaces-control";
import { publishDocSiteBuild } from "@acme/cloud";

import { env } from "~/env";
import { processDocSiteBuildJob } from "./build";

/**
 * Prod (QSTASH_TOKEN set): hand off to QStash, return immediately.
 * Local dev (unset): run projection inline so no tunnel is needed. The external
 * runner is still required to produce a build — inline dev gets you as far as a
 * bundle in S3 and a clear failure if the runner isn't configured.
 *
 * Same QStash-or-inline switch as compile, extract, and artifact generation.
 */
export async function dispatchDocSiteBuild(args: {
  buildId: string;
  docSiteId: string;
  workspaceId: string;
}): Promise<void> {
  const data = { jobId: randomUUID(), ...args };
  if (env.QSTASH_TOKEN) {
    await publishDocSiteBuild(data);
    return;
  }
  try {
    await processDocSiteBuildJob(data);
  } catch (err) {
    // The job already marked the build and site failed before rethrowing;
    // swallow so an inline failure doesn't 500 the triggering request, exactly
    // as a QStash job failing never fails the enqueue in prod.
    console.error("[docsite] inline build failed (build marked failed)", err);
  }
}

/**
 * The port handed to `publishDocSiteDeployment`, keeping the control layer in
 * `@acme/api` free of QStash and app imports. Mirrors `compilePort`.
 */
export const docSiteBuildPort: DocSiteBuildPort = {
  enqueue: dispatchDocSiteBuild,
};
