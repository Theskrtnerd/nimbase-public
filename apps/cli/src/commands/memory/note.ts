import type { Command } from "commander";

import { noteResponseSchema } from "@acme/validators/cli";

import { printJson, printLine } from "../../output";
import { workspaceScope } from "../../workspace";

/**
 * A compiled note is memory's default noun, so it takes the bare `get` rather
 * than sitting under a `notes` group the way captures do.
 */
export function registerMemoryNote(program: Command): void {
  program
    .command("get")
    .description("Print the full markdown body of a note by its id")
    .argument("<nodeId>", "note id (from a search hit)")
    .action(async (nodeId: string, _options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const note = await ctx.client.request("GET", `/api/notes/${nodeId}`, {
        query: { workspaceId },
        schema: noteResponseSchema,
        notFound: `No note with id ${nodeId} in this workspace.`,
      });
      if (ctx.globals.json) {
        printJson(note);
        return;
      }
      printLine(note.title);
      printLine(note.path);
      printLine("─".repeat(Math.min(note.title.length, 60)));
      printLine(note.body);
      if (note.tags && note.tags.length > 0) {
        printLine("");
        printLine(`tags: ${note.tags.join(", ")}`);
      }
      if (note.sources && note.sources.length > 0) {
        printLine("");
        printLine("sources:");
        for (const source of note.sources) {
          printLine(
            `  - [${source.kind}] ${source.title ?? source.sourceUrl ?? source.id}`,
          );
        }
      }
    });
}
