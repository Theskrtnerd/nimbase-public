import "server-only";

import { z } from "zod/v4";

import type { AccessContext } from "@acme/api/access";
import type { ArtifactVisibility, GroupMcpTool } from "@acme/db/schema";
import { toProviderContext, toSearchHit } from "@acme/runtime/memory";
import { memoryProvider } from "@acme/runtime/memory/wiki-pg-provider";

import {
  authorArtifact,
  CREATE_ARTIFACT_DESCRIPTION,
  CREATE_ARTIFACT_PROMPT_DESCRIPTION,
} from "~/server/artifact/authoring";
import { ingestSource } from "~/server/ingest/ingest-source";
import { getNoteForAccess } from "~/server/kb/get-note";
import { listSourcesForAccess } from "~/server/kb/list-sources";
import { errorResult, jsonResult, toErrorMessage } from "~/server/mcp/result";

// Minimal shape we use from mcp-handler's server; avoids importing the peer dep.
interface McpServerLike {
  tool: (
    name: string,
    description: string,
    shape: Record<string, unknown>,
    handler: (args: never, extra: unknown) => Promise<unknown>,
  ) => void;
}

async function guard(
  run: () => Promise<ReturnType<typeof jsonResult>>,
): Promise<ReturnType<typeof jsonResult>> {
  try {
    return await run();
  } catch (err) {
    return errorResult(toErrorMessage(err));
  }
}

// All tools resolve `access` per call via `getAccess(extra)` rather than
// closing over a fixed value. The route (Task 6) stashes the per-request
// fenced AccessContext in extra.authInfo.extra.groupMcpAccess and passes a
// getter that reads it — resolving per call keeps revocation immediate and
// matches the existing endpoint's per-call principal model.
export interface GroupMcpToolOptions {
  // The deployment folder every write tool anchors to. Passed from the endpoint
  // row rather than derived from the caller's context: the write target is
  // admin config, not something a principal brings with it. (This previously
  // read `access.restricted[0]`, on the belief that a fenced context carries
  // exactly one restricted path — but anchoredContext puts the folder in
  // `grants` and the workspace-wide restricted list in `restricted`, so it
  // resolved an unrelated folder and every write denied.)
  folderId: string | null;
  folderPath: string;
  // Exposure of authored artifactes. Admin config: a tool call chooses what the
  // page says, never who can open it.
  artifactVisibility: ArtifactVisibility;
}

export function registerGroupMcpTools(
  server: McpServerLike,
  getAccess: (extra: unknown) => AccessContext,
  tools: GroupMcpTool[],
  options: GroupMcpToolOptions,
): void {
  const enabled = new Set(tools);

  if (enabled.has("search")) {
    server.tool(
      "search",
      "Hybrid keyword + semantic search over this group's knowledge slice. Returns ranked hits; use get_note to read a hit's full body.",
      {
        query: z
          .string()
          .max(500)
          .describe("Natural-language or keyword query"),
        limit: z.number().int().min(1).max(50).optional(),
      },
      (args: { query: string; limit?: number }, extra: unknown) =>
        guard(async () => {
          const access = getAccess(extra);
          const results = await memoryProvider.search(
            toProviderContext(access),
            { text: args.query, limit: args.limit ?? 10 },
          );
          const hits = results.map(toSearchHit);
          return jsonResult(`${hits.length} hit(s) for "${args.query}"`, hits);
        }),
    );
  }

  if (enabled.has("get_note")) {
    server.tool(
      "get_note",
      "Fetch the full compiled body of a note or dataset by nodeId within this group's slice.",
      { nodeId: z.uuid().describe("Note id from a search hit") },
      (args: { nodeId: string }, extra: unknown) =>
        guard(async () => {
          const access = getAccess(extra);
          const note = await getNoteForAccess(access, args.nodeId);
          if (!note) return errorResult("note not found");
          return jsonResult(note.path, note);
        }),
    );
  }

  if (enabled.has("list_sources")) {
    server.tool(
      "list_sources",
      "List the captured sources feeding this group's slice, with compile status.",
      {},
      (_args: Record<string, never>, extra: unknown) =>
        guard(async () => {
          const access = getAccess(extra);
          const { sources } = await listSourcesForAccess(access);
          return jsonResult(`${sources.length} source(s)`, sources);
        }),
    );
  }

  if (enabled.has("capture")) {
    server.tool(
      "capture",
      "Capture a source (text/markdown) into this group's slice. Compilation is asynchronous.",
      {
        kind: z.enum(["web", "chat_export", "highlight", "file"]),
        sourceUrl: z.url().optional(),
        title: z.string().max(512).optional(),
        text: z.string().optional(),
      },
      (
        args: {
          kind: "web" | "chat_export" | "highlight" | "file";
          sourceUrl?: string;
          title?: string;
          text?: string;
        },
        extra: unknown,
      ) =>
        guard(async () => {
          const access = getAccess(extra);
          if (!access.canCapture(options.folderPath)) {
            return errorResult("not allowed to capture into this group");
          }
          const result = await ingestSource(
            {
              kind: args.kind,
              sourceUrl: args.sourceUrl,
              title: args.title,
              text: args.text,
            },
            {
              workspaceId: access.workspaceId,
              userId: access.userId,
              targetFolderId: options.folderId,
            },
          );
          return jsonResult("captured", result);
        }),
    );
  }

  if (enabled.has("create_artifact")) {
    server.tool(
      "create_artifact",
      CREATE_ARTIFACT_DESCRIPTION,
      {
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe(CREATE_ARTIFACT_PROMPT_DESCRIPTION),
      },
      (args: { prompt: string }, extra: unknown) =>
        guard(async () => {
          const access = getAccess(extra);
          // Artifact creation is gated on canCapture at the anchor, same as
          // capture — resolveGroupMcpAccess only grants contributor when the
          // caller may already write there, so a read-only caller stops here.
          if (!access.canCapture(options.folderPath)) {
            return errorResult("not allowed to build artifacts for this group");
          }
          const message = await authorArtifact(args.prompt, {
            workspaceId: access.workspaceId,
            targetFolderId: options.folderId,
            readScopes: access.scopes("viewer") ?? [],
            visibility: options.artifactVisibility,
          });
          return jsonResult(message, { message });
        }),
    );
  }
}
