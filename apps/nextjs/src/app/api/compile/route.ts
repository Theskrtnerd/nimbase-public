import { compileJobSchema } from "@acme/cloud/queue";

import { runCompileJob } from "~/server/compile/dispatch";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";

// The publisher's schema, not a local mirror — a mirror that drops a field
// strips it silently on parse.
const Body = compileJobSchema;

async function handler(request: Request): Promise<Response> {
  // Bodies are always published by publishCompile, so a parse failure is
  // unexpected; letting it 500 (→ QStash retry) is the intended behavior
  // rather than a 400.
  const data = Body.parse(await request.json());
  // Throwing surfaces a 500 so QStash retries; the compile step already
  // marks the job/source failed before rethrowing.
  await runCompileJob(data);
  return Response.json({ ok: true });
}

export const POST = verifyQstashSignature(handler);
