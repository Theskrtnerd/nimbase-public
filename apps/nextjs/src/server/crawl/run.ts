import "server-only";

import type { ConnectorItem, JsonValue } from "@nimbase/connector-sdk";
import {
  CONNECTOR_PROTOCOL_VERSION,
  jsonValueSchema,
} from "@nimbase/connector-sdk";

import type { CrawlJobData } from "@acme/cloud/queue";
import type { SourceConnection as SourceConnectionRow } from "@acme/db/schema";
import { EntitlementError } from "@acme/api/entitlements";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { CrawlRun, SourceConnection } from "@acme/db/schema";

import { decryptConnectionSecret } from "../connection-secret";
import { ingestSource } from "../ingest/ingest-source";
import {
  nextRunAfterFailure,
  nextRunAfterSuccess,
  shouldPark,
} from "./backoff";
import { idempotencyKeyForItem } from "./idempotency";
import { connectorAdapterFor } from "./registry";

type ConnectionRow = typeof SourceConnectionRow.$inferSelect;

const DEFAULT_MAX_ITEMS = 200;

interface CrawlOutcome {
  ingested: number;
  skipped: number;
  seen: number;
  cursor: JsonValue | null;
  capped: boolean;
  pausedForLimit: boolean;
}

// The shared runtime owns scheduling, retry, deduplication, ingestion, and
// permission enforcement. Provider knowledge stays behind ConnectorAdapter.
export async function runCrawlJob(data: CrawlJobData): Promise<void> {
  const [connection] = await db
    .select()
    .from(SourceConnection)
    .where(eq(SourceConnection.id, data.connectionId))
    .limit(1);
  if (connection?.status !== "active") return;

  const now = new Date();
  const [run] = await db
    .insert(CrawlRun)
    .values({
      id: data.runId,
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
    })
    .onConflictDoUpdate({
      target: CrawlRun.id,
      set: {
        status: "running",
        itemsSeen: 0,
        itemsIngested: 0,
        itemsSkipped: 0,
        error: null,
        startedAt: now,
        finishedAt: null,
      },
      setWhere: eq(CrawlRun.status, "running"),
    })
    .returning({ id: CrawlRun.id });
  if (!run) return;

  try {
    const outcome = await pullConnection(connection);
    await finishSuccess(connection, outcome, now, run.id);
  } catch (error) {
    await finishFailure(connection, error, now, run.id);
  }
}

async function pullConnection(
  connection: ConnectionRow,
): Promise<CrawlOutcome> {
  const maxItems = connection.config?.maxItemsPerRun ?? DEFAULT_MAX_ITEMS;
  const configuration = jsonValueSchema.parse(connection.config ?? {});
  if (
    configuration === null ||
    Array.isArray(configuration) ||
    typeof configuration !== "object"
  ) {
    throw new Error("connector configuration must be a JSON object");
  }
  const adapter = connectorAdapterFor(connection.provider);
  const requestContext = {
    endpointUrl: connection.connectorUrl,
    secret: connection.secretsEncrypted
      ? decryptConnectionSecret(connection.secretsEncrypted)
      : null,
  };
  const manifest = await adapter.manifest(requestContext);
  if (manifest.id !== connection.provider) {
    throw new Error("connector manifest id changed after registration");
  }
  const response = await adapter.pull(requestContext, {
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
    connectionId: connection.id,
    cursor: connection.cursor,
    configuration,
    limit: maxItems,
  });
  if (response.items.length > maxItems) {
    throw new Error("connector returned more items than requested");
  }
  return ingestItems(
    connection,
    response.items,
    response.nextCursor,
    response.hasMore,
  );
}

export async function ingestItems(
  connection: ConnectionRow,
  items: ConnectorItem[],
  cursor: JsonValue | null,
  capped: boolean,
): Promise<CrawlOutcome> {
  let ingested = 0;
  let skipped = 0;
  for (const item of items) {
    try {
      const result = await ingestSource(
        {
          kind: item.kind,
          title: item.title,
          text: item.markdown,
          sourceUrl: item.sourceUrl,
          capturedAt: item.updatedAt,
          idempotencyKey: idempotencyKeyForItem(
            connection.provider,
            connection.id,
            item,
          ),
          metadata: { ...item.metadata, provider: connection.provider },
          connectionId: connection.id,
          externalId: item.externalId,
          skipIfDuplicate: true,
          providerAccessPolicy: item.accessPolicy
            ? {
                version: 1,
                provider: connection.provider,
                tenantId: connection.routeKey,
                visibility: item.accessPolicy.visibility,
                completeness: item.accessPolicy.completeness,
                grants: item.accessPolicy.grants,
              }
            : undefined,
        },
        {
          workspaceId: connection.workspaceId,
          userId: connection.createdByUserId,
          targetFolderId: connection.targetFolderId,
        },
      );
      if (result.status === "skipped") skipped++;
      else ingested++;
    } catch (error) {
      if (error instanceof EntitlementError) {
        return {
          ingested,
          skipped,
          seen: items.length,
          cursor: connection.cursor,
          capped,
          pausedForLimit: true,
        };
      }
      throw error;
    }
  }
  return {
    ingested,
    skipped,
    seen: items.length,
    cursor,
    capped,
    pausedForLimit: false,
  };
}

async function finishSuccess(
  connection: ConnectionRow,
  outcome: CrawlOutcome,
  now: Date,
  runId: string,
): Promise<void> {
  const paused = outcome.pausedForLimit;
  await db
    .update(SourceConnection)
    .set({
      cursor: outcome.cursor,
      lastRunAt: now,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      lastError: paused ? "limit_reached" : null,
      status: paused ? "paused" : "active",
      nextRunAt: paused
        ? null
        : outcome.capped
          ? now
          : nextRunAfterSuccess(now, connection.intervalSeconds),
    })
    .where(eq(SourceConnection.id, connection.id));

  await db
    .update(CrawlRun)
    .set({
      status: "done",
      itemsSeen: outcome.seen,
      itemsIngested: outcome.ingested,
      itemsSkipped: outcome.skipped,
      finishedAt: now,
      error: paused ? "limit_reached" : null,
    })
    .where(eq(CrawlRun.id, runId));
}

async function finishFailure(
  connection: ConnectionRow,
  error: unknown,
  now: Date,
  runId: string,
): Promise<void> {
  const failures = connection.consecutiveFailures + 1;
  const parked = shouldPark(failures);
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(SourceConnection)
    .set({
      lastRunAt: now,
      consecutiveFailures: failures,
      lastError: message.slice(0, 500),
      status: parked ? "error" : connection.status,
      nextRunAt: parked
        ? null
        : nextRunAfterFailure(now, connection.intervalSeconds, failures),
    })
    .where(eq(SourceConnection.id, connection.id));
  await db
    .update(CrawlRun)
    .set({ status: "failed", error: message.slice(0, 500), finishedAt: now })
    .where(eq(CrawlRun.id, runId));
}
