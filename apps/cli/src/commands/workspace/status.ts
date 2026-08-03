import type { Command } from "commander";

import { workspaceStatusSchema } from "@acme/validators/cli";

import { printJson, printLine, renderTable } from "../../output";
import { workspaceScope } from "../../workspace";

export function registerWorkspaceStatus(program: Command): void {
  program
    .command("status")
    .description("Show workspace plan, memory, and synchronization health")
    .action(async (_options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const status = await ctx.client.request("GET", "/api/status", {
        query: { workspaceId },
        schema: workspaceStatusSchema,
      });
      if (ctx.globals.json) {
        printJson(status);
        return;
      }

      printLine(`${status.workspace.name} · ${status.workspace.slug}`);
      printLine(
        `Plan: ${status.plan.id}${status.plan.status ? ` (${status.plan.status})` : ""}`,
      );
      printLine(`Brain: ${status.workspace.brainInitStatus}`);
      printLine(`Memory: ${status.memory.compiled} compiled concepts`);
      printLine(`Captures: ${status.captures.total}`);
      const captureRows = Object.entries(status.captures.byStatus);
      if (captureRows.length > 0) {
        printLine(
          renderTable(
            captureRows.map(([captureStatus, count]) => ({
              status: captureStatus,
              count,
            })),
            [
              { key: "status", header: "CAPTURE STATUS" },
              { key: "count", header: "COUNT" },
            ],
          ),
        );
      }
      printLine(`Connected sources: ${status.connections.total}`);
      printLine(
        `  active ${status.connections.byStatus.active ?? 0} · paused ${status.connections.byStatus.paused ?? 0} · error ${status.connections.byStatus.error ?? 0}`,
      );
      if (status.connections.incomplete.length > 0) {
        printLine(
          `Needs configuration: ${status.connections.incomplete
            .map((connection) => connection.displayName ?? connection.provider)
            .join(", ")}`,
        );
      }
      if (status.connections.unhealthy.length > 0) {
        printLine("Unhealthy connections:");
        for (const connection of status.connections.unhealthy) {
          printLine(
            `  ${connection.displayName ?? connection.provider}: ${connection.lastError ?? connection.status}`,
          );
        }
      }
    });
}
