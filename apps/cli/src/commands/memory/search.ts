import type { Command } from "commander";

import { usageError } from "../../errors";
import { printJson, printLine } from "../../output";
import { workspaceScope } from "../../workspace";

interface SearchHit {
  nodeId: string;
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export function registerMemorySearch(program: Command): void {
  program
    .command("search")
    .description("Hybrid keyword + semantic search over your notes")
    .argument("<query>", "search query")
    .option("--limit <n>", "max results (1-50)")
    .action(
      async (query: string, options: { limit?: string }, command: Command) => {
        const { ctx, workspaceId } = await workspaceScope(command);

        let limit: number | undefined;
        if (options.limit !== undefined) {
          limit = Number(options.limit);
          if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            throw usageError("--limit must be an integer between 1 and 50");
          }
        }

        const { results } = await ctx.client.request<{ results: SearchHit[] }>(
          "POST",
          "/api/search",
          { body: { workspaceId, query, limit } },
        );

        if (ctx.globals.json) {
          printJson({ results });
          return;
        }
        if (results.length === 0) {
          printLine(`No results for "${query}".`);
          return;
        }
        for (const hit of results) {
          printLine(hit.title);
          if (hit.snippet) printLine(`  ${hit.snippet}`);
          printLine(`  id ${hit.nodeId}  ·  ${hit.path}`);
          printLine();
        }
      },
    );
}
