import "server-only";

import type { CrawlJobData } from "@acme/runtime/queue";
import { publishCrawl } from "@acme/runtime/queue";

import { env } from "~/env";

// Same QStash-or-inline switch as dispatchExtract/dispatchCompile: enqueue in
// prod, run inline in dev (swallowing the error — runCrawlJob already records
// the failure on the connection/CrawlRun, and rethrowing would 500 whatever
// triggered the dispatch, e.g. a "Sync now" click).
export async function dispatchCrawl(data: CrawlJobData): Promise<void> {
  if (env.QSTASH_TOKEN) {
    await publishCrawl(data);
    return;
  }
  try {
    const { runCrawlJob } = await import("./run");
    await runCrawlJob(data);
  } catch (err) {
    console.error(`inline crawl job ${data.jobId} failed`, err);
  }
}
