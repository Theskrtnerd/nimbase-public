import "server-only";

import { randomUUID } from "node:crypto";

import type { CrawlPort } from "@acme/api";

import { dispatchCrawl } from "./dispatch";

// CrawlPort implementation injected into the tRPC context (see trpc.ts). Keeps
// the api package free of queue + env knowledge — same pattern as compilePort.
export const crawlPort: CrawlPort = {
  async enqueue({ connectionId, workspaceId }) {
    const runId = randomUUID();
    await dispatchCrawl({
      jobId: randomUUID(),
      runId,
      connectionId,
      workspaceId,
    });
    return { runId };
  },
  providers() {
    return [];
  },
};
