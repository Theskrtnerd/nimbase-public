import { docSiteBuildJobSchema } from "@acme/cloud/queue";

import { processDocSiteBuildJob } from "~/server/docsite/build";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";
// Projection reads every page body from S3 and then makes one model call; the
// external build itself runs elsewhere and reports back asynchronously.
export const maxDuration = 300;

// The publisher's schema, not a local mirror.
const Body = docSiteBuildJobSchema;

async function handler(request: Request): Promise<Response> {
  const data = Body.parse(await request.json());
  // Throwing surfaces a 500; processDocSiteBuildJob already marked the build
  // and the site failed before rethrowing.
  await processDocSiteBuildJob(data);
  return Response.json({ ok: true });
}

export const POST = verifyQstashSignature(handler);
