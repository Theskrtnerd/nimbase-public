import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod/v4";

import type { PathScope } from "@acme/db";

import type { GardenerFs } from "../memory/wiki/vfs";
import { vfsCall } from "../memory/wiki/vfs-read-tools";

// Host-executed custom tools for harness agents. Generic file access (read/
// write/edit/grep/glob/ls/bash) comes from the harness built-ins over the
// mounted wiki; these cover what a filesystem can't express — embedding
// search and the wiki's domain metadata (tags, titles, citations).
// Paths taken by these tools are wiki paths WITHOUT the /wiki mount prefix
// (same shape the legacy tools used); each description says so.
//
// Search arrives as a callback rather than an import of ../search. @acme/runtime
// already depends on @acme/agents, so a harness module reaching back into
// cloud is what makes this runtime unmovable — see ./bindings.ts, which is the
// one file that supplies the cloud implementation.

export interface KbSearchHit {
  path: string;
  snippet: string;
}

export type KbSearchFn = (args: {
  workspaceId: string;
  query: string;
  limit: number;
  scopes: PathScope[] | undefined;
}) => Promise<KbSearchHit[]>;

export function kbSearchTool(opts: {
  workspaceId: string;
  scopes: PathScope[] | undefined;
  search: KbSearchFn;
}): ToolSet {
  return {
    search: tool({
      description:
        "Hybrid semantic + keyword search over the wiki. Best first move to find where a topic lives. Returns wiki paths (add the /wiki mount prefix to open them with file tools).",
      inputSchema: z.object({
        query: z.string().max(500),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: ({ query, limit }) =>
        vfsCall(async () => {
          const hits = await opts.search({
            workspaceId: opts.workspaceId,
            query,
            limit: limit ?? 10,
            scopes: opts.scopes,
          });
          if (hits.length === 0) return "no results";
          return hits.map((h) => `${h.path} — ${h.snippet}`).join("\n");
        }),
    }),
  };
}

// The gardener's metadata/domain tools. Generic file operations are absent
// because the harness built-ins own them through the sandbox filesystem.
export function gardenerDomainTools(fs: GardenerFs): ToolSet {
  return {
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
        "List the sources (captures) attributed to a note — id, kind, title/url. Call this on a note before merging its content elsewhere and deleting it, then cite its source ids onto the surviving note with cite_sources so provenance isn't lost. Takes a wiki path without the /wiki prefix.",
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
    set_tags: tool({
      description:
        "Set a note's tags (replaces all of them). Call list_tags first to reuse existing tags. Tags are stored automatically — never write tag frontmatter by hand. Takes a wiki path without the /wiki prefix.",
      inputSchema: z.object({
        path: z.string(),
        tags: z.array(z.string()).max(12),
      }),
      execute: ({ path, tags }) => vfsCall(() => fs.setTags(path, tags)),
    }),
    set_title: tool({
      description:
        "Change an existing note's title. Every note has a title already (set at creation via frontmatter); use this to correct or improve one. Takes a wiki path without the /wiki prefix.",
      inputSchema: z.object({
        path: z.string(),
        title: z.string().min(1).max(120),
      }),
      execute: ({ path, title }) => vfsCall(() => fs.setTitle(path, title)),
    }),
    cite_sources: tool({
      description:
        "Attribute source ids to a note (additive — never removes existing citations). Use on the surviving note before rm'ing a note you merged into it, with the merged note's source ids (from list_citations), so its provenance isn't lost. Takes a wiki path without the /wiki prefix.",
      inputSchema: z.object({
        path: z.string(),
        sourceIds: z.array(z.string().uuid()).min(1).max(20),
      }),
      execute: ({ path, sourceIds }) =>
        vfsCall(() => fs.citeSources(path, sourceIds)),
    }),
  };
}
