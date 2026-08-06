import { crawlJobSchema } from "@acme/runtime/queue";

import { runCrawlJob } from "~/server/crawl/run";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";
export const maxDuration = 300;

// The publisher's schema, not a local mirror — a mirror that drops a field
// strips it silently on parse.
const Body = crawlJobSchema;

// Per-connection crawl worker. A parse failure or a thrown job 500s → QStash
// retries; runCrawlJob has already recorded the failure on the connection.
async function handler(request: Request): Promise<Response> {
  const data = Body.parse(await request.json());
  await runCrawlJob(data);
  return Response.json({ ok: true });
}

export const POST = verifyQstashSignature(handler);
