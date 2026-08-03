import type { Command } from "commander";
import { z } from "zod/v4";

import type {
  ConnectionSummary,
  CrawlRun,
  SyncRequested,
} from "@acme/validators/cli";
import {
  connectionsResponseSchema,
  crawlRunSchema,
  syncRequestedSchema,
} from "@acme/validators/cli";

import type { ApiClient } from "../../client";
import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { CliError, usageError } from "../../errors";
import { printJson, printLine, renderTable } from "../../output";
import { sleep } from "../../wait";
import { resolveWorkspace } from "../../workspace";

const POLL_MS = 2000;
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;

export interface SyncFailure {
  connectionId: string;
  stage: "enqueue" | "wait" | "crawl";
  error: string;
}

export function registerSyncRun(program: Command): void {
  program
    .command("run")
    .description(
      "Synchronize a connector, connection, or all active sources now",
    )
    .argument("[target]", "connector or connection id; omit to sync all")
    .option("--wait", "wait for every crawl run to finish")
    .action(
      async (
        target: string | undefined,
        options: { wait?: boolean },
        command: Command,
      ) => {
        const ctx = await createContext(command);
        requireSession(ctx.config, "`nimbase sync run`");
        const workspaceId = await resolveWorkspace(ctx);
        const connectionIds = await resolveConnectionIds(
          ctx.client,
          workspaceId,
          target,
        );
        if (connectionIds.length === 0) {
          throw usageError("No active source connections to synchronize.");
        }

        const enqueueResults = await Promise.allSettled(
          connectionIds.map((id) =>
            ctx.client.request("POST", `/api/connections/${id}/sync`, {
              body: { workspaceId },
              schema: syncRequestedSchema,
            }),
          ),
        );
        const { requested, failures } = collectSyncRequests(
          connectionIds,
          enqueueResults,
        );

        if (!options.wait) {
          if (ctx.globals.json) {
            printJson({ runs: requested, errors: failures });
          } else {
            for (const run of requested) {
              printLine(
                `Sync queued for ${run.connectionId}. run ${run.runId}`,
              );
            }
            printFailures(failures);
          }
          if (failures.length > 0) {
            throw new CliError(
              `${failures.length} source synchronization request(s) failed`,
              1,
            );
          }
          return;
        }

        const waitResults = await Promise.allSettled(
          requested.map((run) => waitForCrawlRun(ctx.client, workspaceId, run)),
        );
        const runs: CrawlRun[] = [];
        waitResults.forEach((result, index) => {
          const syncRequest = requested[index];
          if (!syncRequest) return;
          if (result.status === "fulfilled") {
            runs.push(result.value);
            return;
          }
          failures.push({
            connectionId: syncRequest.connectionId,
            stage: "wait",
            error: errorMessage(result.reason),
          });
        });
        for (const run of runs) {
          if (run.status !== "failed") continue;
          failures.push({
            connectionId: run.connectionId,
            stage: "crawl",
            error: run.error ?? "Source synchronization failed",
          });
        }
        if (ctx.globals.json) {
          printJson({ runs, errors: failures });
        } else {
          if (runs.length > 0) {
            printLine(
              renderTable(
                runs.map((run) => ({
                  status: run.status,
                  ingested: run.itemsIngested,
                  skipped: run.itemsSkipped,
                  seen: run.itemsSeen,
                  connection: run.connectionId,
                  run: run.id,
                })),
                [
                  { key: "status", header: "STATUS" },
                  { key: "ingested", header: "INGESTED" },
                  { key: "skipped", header: "SKIPPED" },
                  { key: "seen", header: "SEEN" },
                  { key: "connection", header: "CONNECTION" },
                  { key: "run", header: "RUN" },
                ],
              ),
            );
          }
          printFailures(failures);
        }
        if (failures.length > 0) {
          throw new CliError(
            `${failures.length} source synchronization operation(s) failed`,
            1,
          );
        }
      },
    );
}

export function collectSyncRequests(
  connectionIds: string[],
  results: PromiseSettledResult<SyncRequested>[],
): { requested: SyncRequested[]; failures: SyncFailure[] } {
  const requested: SyncRequested[] = [];
  const failures: SyncFailure[] = [];
  results.forEach((result, index) => {
    const requestedConnectionId = connectionIds[index];
    if (!requestedConnectionId) return;
    if (result.status === "fulfilled") {
      requested.push(result.value);
      return;
    }
    failures.push({
      connectionId: requestedConnectionId,
      stage: "enqueue",
      error: errorMessage(result.reason),
    });
  });
  return { requested, failures };
}

function printFailures(failures: SyncFailure[]): void {
  for (const failure of failures) {
    printLine(
      `Sync failed for ${failure.connectionId} during ${failure.stage}: ${failure.error}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function resolveConnectionIds(
  client: Pick<ApiClient, "request">,
  workspaceId: string,
  target: string | undefined,
): Promise<string[]> {
  if (target && z.uuid().safeParse(target).success) return [target];

  const response = await client.request("GET", "/api/connections", {
    query: { workspaceId },
    schema: connectionsResponseSchema,
  });
  return connectionIdsForProvider(response.connections, target);
}

export function connectionIdsForProvider(
  connections: ConnectionSummary[],
  provider: string | undefined,
): string[] {
  const active = connections.filter(
    (connection) => connection.status === "active",
  );
  if (!provider) {
    return active.map((connection) => connection.id);
  }
  const matches = active.filter(
    (connection) => connection.provider === provider,
  );
  if (matches.length === 0) {
    throw usageError(`No active ${provider} connection to synchronize.`);
  }
  if (matches.length > 1) {
    throw usageError(
      `More than one active ${provider} connection exists; use a connection id.`,
    );
  }
  const [connection] = matches;
  return connection ? [connection.id] : [];
}

async function waitForCrawlRun(
  client: ApiClient,
  workspaceId: string,
  requested: SyncRequested,
): Promise<CrawlRun> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      const run = await client.request(
        "GET",
        `/api/crawl-runs/${requested.runId}`,
        {
          query: { workspaceId },
          schema: crawlRunSchema,
        },
      );
      if (run.status !== "running") return run;
    } catch (error) {
      if (!(error instanceof CliError) || error.httpStatus !== 404) throw error;
    }
    if (Date.now() > deadline) {
      throw new CliError(
        `Timed out waiting for crawl run ${requested.runId}`,
        1,
      );
    }
    await sleep(POLL_MS);
  }
}
