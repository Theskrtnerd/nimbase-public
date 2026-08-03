import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull, lte, or, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { SourceConnection } from "@acme/db/schema";

import { dispatchCrawl } from "./dispatch";

// One master tick. Atomically claims every due connection — the same UPDATE
// that selects them pushes next_run_at forward — so two overlapping ticks can
// never dispatch the same connection twice. Then fans out one crawl job each.
export async function runCrawlScheduler(
  now: Date = new Date(),
): Promise<{ dispatched: number }> {
  const claimed = await db
    .update(SourceConnection)
    .set({
      nextRunAt: sql`now() + (${SourceConnection.intervalSeconds} * interval '1 second')`,
    })
    .where(
      and(
        eq(SourceConnection.status, "active"),
        or(
          isNull(SourceConnection.nextRunAt),
          lte(SourceConnection.nextRunAt, now),
        ),
      ),
    )
    .returning({
      id: SourceConnection.id,
      workspaceId: SourceConnection.workspaceId,
    });

  // Dispatch in parallel with per-connection isolation: each connection was
  // already claimed (its next_run_at bumped), so a single failed publish must
  // not abort the loop — that would strand every not-yet-dispatched connection
  // for a whole interval. allSettled lets the rest through; a stranded one just
  // waits for its next due tick.
  const results = await Promise.allSettled(
    claimed.map((conn) =>
      dispatchCrawl({
        jobId: randomUUID(),
        runId: randomUUID(),
        connectionId: conn.id,
        workspaceId: conn.workspaceId,
      }),
    ),
  );
  const dispatched = results.filter((r) => r.status === "fulfilled").length;
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("crawl dispatch failed", r.reason);
    }
  }
  return { dispatched };
}
