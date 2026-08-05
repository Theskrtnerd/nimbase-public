import { extractJobSchema } from "@acme/runtime/queue";

import { runExtractJob } from "~/server/ingest/extract-dispatch";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";

// The publisher's schema, not a local mirror — a mirror that drops a field
// strips it silently on parse.
const Body = extractJobSchema;

async function handler(request: Request): Promise<Response> {
  // Bodies are always published by publishExtract, so a parse failure is
  // unexpected; letting it 500 (→ QStash retry) is the intended behavior
  // rather than a 400.
  const data = Body.parse(await request.json());
  // Throwing surfaces a 500 so QStash retries; processExtractJob already
  // marks the source failed before rethrowing. runExtractJob adds the
  // archive-children dispatch tail.
  await runExtractJob(data);
  return Response.json({ ok: true });
}

export const POST = verifyQstashSignature(handler);
