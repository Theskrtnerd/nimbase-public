import type { Command } from "commander";

import type { SourceDetail } from "@acme/validators/cli";
import {
  sourceDetailSchema,
  sourcesResponseSchema,
} from "@acme/validators/cli";

import { printJson, printLine, renderTable } from "../../output";
import { collectAllPages } from "../../paginate";
import { workspaceScope } from "../../workspace";

/**
 * Captured items (`Source`) — the things that flow into memory. Kept as a
 * `list`/`get` pair like every other noun in the CLI so `--json` has one
 * shape per command; the `capture` verb that creates them is a sibling.
 */
export function registerMemoryCaptures(program: Command): void {
  const captures = program
    .command("captures")
    .description("Inspect captured items and their compile status");

  captures
    .command("list")
    .description("List captures and their compile status")
    .action(async (_options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const sources = await collectAllPages(async (cursor) => {
        const page = await ctx.client.request("GET", "/api/sources", {
          query: { workspaceId, cursor },
          schema: sourcesResponseSchema,
        });
        return { items: page.sources, nextCursor: page.nextCursor };
      });

      if (ctx.globals.json) {
        printJson({ sources });
        return;
      }
      if (sources.length === 0) {
        printLine("No captures.");
        return;
      }
      printLine(
        renderTable(
          sources.map((source) => ({
            status: source.status,
            kind: source.kind,
            title: source.title ?? "",
            id: source.id,
          })),
          [
            { key: "status", header: "STATUS" },
            { key: "kind", header: "KIND" },
            { key: "title", header: "TITLE" },
            { key: "id", header: "ID" },
          ],
        ),
      );
    });

  captures
    .command("get")
    .description("Inspect one captured item")
    .argument("<captureId>", "captured item id")
    .action(async (captureId: string, _options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const source = await ctx.client.request(
        "GET",
        `/api/sources/${captureId}`,
        {
          query: { workspaceId },
          schema: sourceDetailSchema,
          notFound: `No capture with id ${captureId} in this workspace.`,
        },
      );
      if (ctx.globals.json) printJson(source);
      else printSource(source);
    });
}

function printSource(source: SourceDetail): void {
  printLine(source.title ?? source.id);
  printLine(`id: ${source.id}`);
  printLine(`kind: ${source.kind}`);
  printLine(`status: ${source.status}`);
  printLine(`target: ${source.targetPath || "(root)"}`);
  if (source.sourceUrl) printLine(`url: ${source.sourceUrl}`);
  if (source.connectionId) printLine(`connection: ${source.connectionId}`);
  if (source.externalId) printLine(`external id: ${source.externalId}`);
  if (source.capturedAt) printLine(`captured: ${source.capturedAt}`);
  if (source.compiledAt) printLine(`compiled: ${source.compiledAt}`);
  if (source.error) printLine(`error: ${source.error}`);
  if (source.metadata) {
    printLine(`metadata: ${JSON.stringify(source.metadata)}`);
  }
  if (source.compileReport) {
    printLine(`compile report: ${JSON.stringify(source.compileReport)}`);
  }
}
