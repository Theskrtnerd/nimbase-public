import { brainInitJobSchema } from "@acme/runtime/queue";

import { runBrainInitJob } from "~/server/brain/init";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";
export const maxDuration = 120;

// The publisher's schema, not a local mirror — a mirror that drops a field
// strips it silently on parse.
const Body = brainInitJobSchema;

async function handler(request: Request): Promise<Response> {
  // Bodies are always published by publishBrainInit, so a parse failure is
  // unexpected; letting it 500 (→ QStash retry) is the intended behavior
  // rather than a 400.
  const data = Body.parse(await request.json());
  // runBrainInitJob is best-effort: it marks the workspace "failed" on error
  // internally and does not rethrow, so this always returns 200 (no QStash
  // retry) — a Biographer failure is user-visible via brainInitStatus, not
  // via job retries.
  await runBrainInitJob(data);
  return Response.json({ ok: true });
}

export const POST = verifyQstashSignature(handler);
