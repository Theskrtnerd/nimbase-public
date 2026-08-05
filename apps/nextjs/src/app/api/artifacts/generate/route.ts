import { artifactGenerateJobSchema } from "@acme/runtime/queue";

import { processArtifactGenerateJob } from "~/server/artifact/generate";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";
// The Claude call dominates; same ceiling the old synchronous route had.
export const maxDuration = 300;

// The publisher's schema, not a local mirror.
const Body = artifactGenerateJobSchema;

async function handler(request: Request): Promise<Response> {
  // Bodies are always published by publishArtifactGenerate, so a parse failure
  // is unexpected; letting it 500 (→ QStash retry) is the intended behavior
  // rather than a 400.
  const data = Body.parse(await request.json());
  // Throwing surfaces a 500 so QStash retries; processArtifactGenerateJob
  // already marks the artifact failed before rethrowing.
  await processArtifactGenerateJob(data);
  return Response.json({ ok: true });
}

export const POST = verifyQstashSignature(handler);
