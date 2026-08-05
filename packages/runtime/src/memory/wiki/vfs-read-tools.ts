import "server-only";

import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod/v4";

import type { SearchScope } from "../../search";
import type { WikiReadFs } from "./vfs";
import { searchWorkspace } from "../../search";
import { VfsError } from "./vfs";

// VfsError is a model-recoverable mistake → return it as the tool result so
// the model can adjust. Anything else is an infra failure → fail the job.
export async function vfsCall(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof VfsError) return `error: ${err.message}`;
    throw err;
  }
}

// The six read-only KB tools, fenced via `scopes` (undefined = unrestricted).
export function readTools(
  fs: WikiReadFs,
  opts: { workspaceId: string; scopes: SearchScope[] | undefined },
): ToolSet {
  return {
    tree: tool({
      description:
        "List every note path in the wiki with its one-line summary and pinned markers.",
      inputSchema: z.object({}),
      execute: () => vfsCall(() => fs.tree()),
    }),
    search: tool({
      description:
        "Hybrid semantic + keyword search over the wiki. Best first move to find where a topic lives.",
      inputSchema: z.object({
        query: z.string().max(500),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: ({ query, limit }) =>
        vfsCall(async () => {
          const hits = await searchWorkspace({
            workspaceId: opts.workspaceId,
            query,
            limit: limit ?? 10,
            scopes: opts.scopes,
          });
          if (hits.length === 0) return "no results";
          return hits.map((h) => `${h.path} — ${h.snippet}`).join("\n");
        }),
    }),
    grep: tool({
      description:
        "Regex search across all note bodies; returns path:line matches. For exact strings/links (e.g. [[wikilinks]]); use search for concepts.",
      inputSchema: z.object({
        pattern: z.string(),
        ignoreCase: z.boolean().optional(),
      }),
      execute: ({ pattern, ignoreCase }) =>
        vfsCall(() => fs.grep(pattern, ignoreCase ?? false)),
    }),
    read: tool({
      description: "Read the full markdown body of a note.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) => vfsCall(() => fs.read(path)),
    }),
    list_tags: tool({
      description:
        "List the tags already used in the wiki with their note counts. Call before tagging so you reuse existing tags instead of coining near-duplicates.",
      inputSchema: z.object({}),
      execute: () =>
        vfsCall(async () => {
          const tags = await fs.listTags();
          if (tags.length === 0) return "no tags yet";
          return tags.map((t) => `${t.tag} (${t.count})`).join("\n");
        }),
    }),
    list_citations: tool({
      description:
        "List the sources (captures) attributed to a note — id, kind, title/url, date. Call this on a note before merging its content elsewhere and deleting it, then cite its source ids onto the surviving note with cite_sources so provenance isn't lost.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) =>
        vfsCall(async () => {
          const sources = await fs.listSources(path);
          if (sources.length === 0) return "no sources linked";
          return sources
            .map(
              (s) =>
                `${s.id} [${s.kind}] ${s.title ?? s.sourceUrl ?? "untitled"}`,
            )
            .join("\n");
        }),
    }),
  };
}
