import { runCrawlScheduler } from "~/server/crawl/scheduler";
import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";

// The single recurring QStash schedule (see ensureCrawlSchedule) hits this
// route; it fans out one crawl job per due connection.
async function handler(_request: Request): Promise<Response> {
  const { dispatched } = await runCrawlScheduler();
  return Response.json({ ok: true, dispatched });
}

export const POST = verifyQstashSignature(handler);
