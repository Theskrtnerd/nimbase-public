import type { Command } from "commander";

import type { ConnectionSummary } from "@acme/validators/cli";
import { connectionDetailSchema } from "@acme/validators/cli";

import { printJson, printLine, renderTable } from "../../output";
import { workspaceScope } from "../../workspace";

export function registerSyncGet(program: Command): void {
  program
    .command("get")
    .description("Inspect a connection and its recent sync runs")
    .argument("<connectionId>", "connection id")
    .action(
      async (connectionId: string, _options: unknown, command: Command) => {
        const { ctx, workspaceId } = await workspaceScope(command);
        const detail = await ctx.client.request(
          "GET",
          `/api/connections/${connectionId}`,
          { query: { workspaceId }, schema: connectionDetailSchema },
        );
        if (ctx.globals.json) {
          printJson(detail);
          return;
        }
        printConnection(detail.connection);
        if (detail.runs.length === 0) return;
        printLine("");
        printLine("Recent runs");
        printLine(
          renderTable(
            detail.runs.map((run) => ({
              status: run.status,
              seen: run.itemsSeen,
              ingested: run.itemsIngested,
              skipped: run.itemsSkipped,
              started: run.startedAt,
              id: run.id,
            })),
            [
              { key: "status", header: "STATUS" },
              { key: "seen", header: "SEEN" },
              { key: "ingested", header: "INGESTED" },
              { key: "skipped", header: "SKIPPED" },
              { key: "started", header: "STARTED" },
              { key: "id", header: "RUN" },
            ],
          ),
        );
      },
    );
}

function printConnection(connection: ConnectionSummary): void {
  const target =
    connection.folderPath && connection.folderPath.length > 0
      ? connection.folderPath
      : "(root)";
  printLine(connection.displayName ?? connection.provider);
  printLine(`id: ${connection.id}`);
  printLine(`provider: ${connection.provider}`);
  printLine(`status: ${connection.status}`);
  printLine(`target: ${target}`);
  printLine(`interval: ${connection.intervalSeconds}s`);
  if (connection.lastRunAt) printLine(`last run: ${connection.lastRunAt}`);
  if (connection.lastSuccessAt) {
    printLine(`last success: ${connection.lastSuccessAt}`);
  }
  if (connection.nextRunAt) printLine(`next run: ${connection.nextRunAt}`);
  if (connection.lastError) printLine(`last error: ${connection.lastError}`);
  if (connection.consecutiveFailures > 0) {
    printLine(`consecutive failures: ${connection.consecutiveFailures}`);
  }
  if (connection.config) {
    printLine(`config: ${JSON.stringify(connection.config)}`);
  }
}
