import "server-only";

import { z } from "zod/v4";

import type { AccessContext } from "@acme/api/access";
import { requireAccess } from "@acme/api/access";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { artifactVisibilitySchema, Workspace } from "@acme/db/schema";
import { toProviderContext, toSearchHit } from "@acme/runtime/memory";
import { memoryProvider } from "@acme/runtime/memory/wiki-pg-provider";

import type { ToolResult } from "./result";
import { env } from "~/env";
import { createArtifact } from "~/server/artifact/create-artifact";
import { authorizeApiToken } from "~/server/auth/authorize-workspace";
import { resolveFolderByPath } from "~/server/folders";
import { ingestSource } from "~/server/ingest/ingest-source";
import { getNoteForAccess } from "~/server/kb/get-note";
import { listSourcesForAccess } from "~/server/kb/list-sources";
import { errorResult, jsonResult, toErrorMessage } from "./result";
import { createMcpCaller } from "./session";

// Derive the McpServer type from createMcpHandler's callback parameter.
// @modelcontextprotocol/sdk is a peer dep of mcp-handler and not directly
// declared in this app's package.json, so we derive rather than import.
type McpServer = Parameters<
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- intentional: derive the type from the peer dep without declaring it as a direct import
  Parameters<typeof import("mcp-handler").createMcpHandler>[0]
>[0];

// Who is calling a tool. Two principals share the MCP surface:
//   user  — Clerk OAuth (dashboard members); gets the full tool set through
//           the in-process tRPC caller.
//   token — a folder-scoped ApiToken (external tools/agents); gets the
//           KB tools (search/get_note/list_sources/capture) through the same
//           access-gated cores the REST routes use. Session-only tools
//           (artifact, workspace listing beyond its own) refuse it.
type McpPrincipal =
  | {
      kind: "user";
      userId: string;
      caller: ReturnType<typeof createMcpCaller>;
    }
  | { kind: "token"; access: AccessContext };

// The second argument to every tool handler. The SDK types it as
// RequestHandlerExtra; we only need the authInfo.extra slots set by the
// transport route's verify callback. Typed as unknown so the handler
// signature stays compatible with all overloads — we narrow at runtime.
async function resolvePrincipal(extra: unknown): Promise<McpPrincipal> {
  const info = (extra as { authInfo?: { extra?: Record<string, unknown> } })
    .authInfo?.extra;
  const tokenAuthorization = info?.apiTokenAuthorization;
  if (typeof tokenAuthorization === "string") {
    // Re-verified per call (cheap) so revocation/expiry cut a live MCP
    // session off immediately instead of at reconnect.
    const authz = await authorizeApiToken(tokenAuthorization);
    if (!authz) throw new Error("Unauthorized");
    return { kind: "token", access: authz.access };
  }
  const userId = info?.userId;
  if (typeof userId !== "string" || !userId) throw new Error("Unauthorized");
  return { kind: "user", userId, caller: createMcpCaller(userId) };
}

// Shared envelope for every tool handler: resolve the principal under one
// error boundary that maps known failures to agent-actionable messages.
async function withPrincipal(
  extra: unknown,
  run: (principal: McpPrincipal) => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await run(await resolvePrincipal(extra));
  } catch (err) {
    return errorResult(toErrorMessage(err));
  }
}

// Envelope for session-only tools (artifact + anything acting as a person).
async function withCaller(
  extra: unknown,
  run: (ctx: {
    caller: ReturnType<typeof createMcpCaller>;
    userId: string;
  }) => Promise<ToolResult>,
): Promise<ToolResult> {
  return withPrincipal(extra, async (principal) => {
    if (principal.kind !== "user") {
      return errorResult(
        "This tool requires user (OAuth) authentication; an API token can't use it.",
      );
    }
    return run({ caller: principal.caller, userId: principal.userId });
  });
}

// Resolve the caller's AccessContext for a target workspace, or null when the
// workspace is invisible to them (nonexistent and unauthorized collapse).
async function accessForWorkspace(
  principal: McpPrincipal,
  workspaceId: string,
): Promise<AccessContext | null> {
  if (principal.kind === "token") {
    return principal.access.workspaceId === workspaceId
      ? principal.access
      : null;
  }
  try {
    return await requireAccess(principal.userId, workspaceId);
  } catch {
    return null;
  }
}

const workspaceIdSchema = z
  .uuid()
  .describe("Workspace id (from list_workspaces)");

export function registerNimbaseTools(server: McpServer): void {
  // list_workspaces — zero-arg tool (empty shape)
  server.tool(
    "list_workspaces",
    "List the knowledge-base workspaces the authenticated user is a member of. Call this first to resolve a workspaceId for the other tools.",
    {},
    (_args, extra) =>
      withPrincipal(extra, async (principal) => {
        // A token is pinned to one workspace; report it so agents can
        // bootstrap the workspaceId without user-only tRPC access.
        if (principal.kind === "token") {
          const rows = await db
            .select({
              id: Workspace.id,
              name: Workspace.name,
              description: Workspace.description,
            })
            .from(Workspace)
            .where(eq(Workspace.id, principal.access.workspaceId))
            .limit(1);
          return jsonResult(`${rows.length} workspace(s)`, rows);
        }
        const rows = await principal.caller.workspace.all();
        const data = rows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
        }));
        return jsonResult(`${data.length} workspace(s)`, data);
      }),
  );

  server.tool(
    "search",
    "Hybrid keyword + semantic search over a workspace's notes and datasets. Returns ranked hits with a snippet; use get_note to read a hit's full body — for a dataset hit, that body is the raw JSON.",
    {
      workspaceId: workspaceIdSchema,
      query: z.string().max(500).describe("Natural-language or keyword query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max hits to return (default 10)"),
    },
    (args, extra) =>
      withPrincipal(extra, async (principal) => {
        const access = await accessForWorkspace(principal, args.workspaceId);
        if (!access) return errorResult("unknown workspace");
        // Through the MemoryProvider seam; map results back to the flat hit
        // shape (nodeId/path/title/snippet/score) this tool has always
        // returned. An empty read scope trips the kernel toolset gate, which
        // withPrincipal surfaces as an error result (unchanged behavior).
        const results = await memoryProvider.search(toProviderContext(access), {
          text: args.query,
          limit: args.limit ?? 10,
        });
        const hits = results.map(toSearchHit);
        return jsonResult(`${hits.length} hit(s) for "${args.query}"`, hits);
      }),
  );

  server.tool(
    "get_note",
    "Fetch the full compiled body of a note or dataset by its nodeId within a workspace — markdown for a note, raw JSON for a dataset (structured/numerical data like health metrics, spreadsheets, time-series). Also returns tags and the sources (captures) it was compiled from.",
    {
      workspaceId: workspaceIdSchema,
      nodeId: z.uuid().describe("Note id (the nodeId from a search hit)"),
    },
    (args, extra) =>
      withPrincipal(extra, async (principal) => {
        const access = await accessForWorkspace(principal, args.workspaceId);
        if (!access) return errorResult("unknown workspace");
        const note = await getNoteForAccess(access, args.nodeId);
        // Not-found and not-readable collapse: invisible notes must not
        // reveal their existence.
        if (!note) return errorResult("note not found");
        return jsonResult(note.path, note);
      }),
  );

  server.tool(
    "capture",
    "Capture a source (web page, chat export, highlight, or a pasted-in file's text) into a workspace. Compilation into notes is asynchronous — poll list_sources to see when status becomes 'compiled'.",
    {
      workspaceId: workspaceIdSchema,
      kind: z
        .enum(["web", "chat_export", "highlight", "file"])
        .describe("Type of captured source"),
      sourceUrl: z.url().optional().describe("Origin URL, if any"),
      title: z.string().max(512).optional(),
      text: z
        .string()
        .optional()
        .describe("Raw text/markdown content to ingest"),
      targetPath: z
        .string()
        .optional()
        .describe(
          'Folder path of the target space, e.g. "sales". Omit for the workspace root.',
        ),
    },
    (args, extra) =>
      withPrincipal(extra, async (principal) => {
        const access = await accessForWorkspace(principal, args.workspaceId);
        if (!access) return errorResult("unknown workspace");

        // Missing and not-capturable collapse to one message so a restricted
        // space is indistinguishable from a nonexistent one.
        const target = await resolveFolderByPath(
          args.workspaceId,
          args.targetPath,
        );
        if (!target) {
          return errorResult(`cannot capture into "${args.targetPath}"`);
        }
        const targetFolderId = target.id;

        if (!access.canCapture(target.path)) {
          return errorResult(
            args.targetPath
              ? `cannot capture into "${args.targetPath}"`
              : "cannot capture into this workspace",
          );
        }

        const result = await ingestSource(
          {
            kind: args.kind,
            sourceUrl: args.sourceUrl,
            title: args.title,
            text: args.text,
          },
          {
            workspaceId: args.workspaceId,
            // Token captures have no acting user; capturedBy stays null,
            // exactly like ApiToken captures through POST /api/ingest.
            userId: principal.kind === "user" ? principal.userId : null,
            targetFolderId,
          },
        );
        return jsonResult(
          "Source queued. Compilation is async — use list_sources to check status.",
          result,
        );
      }),
  );

  server.tool(
    "list_sources",
    "List recently captured sources in a workspace with their compile status — use to confirm a capture finished compiling.",
    { workspaceId: workspaceIdSchema },
    (args, extra) =>
      withPrincipal(extra, async (principal) => {
        const access = await accessForWorkspace(principal, args.workspaceId);
        if (!access) return errorResult("unknown workspace");
        const { sources } = await listSourcesForAccess(access);
        return jsonResult(`${sources.length} source(s)`, sources);
      }),
  );

  server.tool(
    "create_artifact",
    "Generate an AI artifact from a prompt over the workspace's notes. Generation is async — poll get_artifact until status is 'draft'. Returns a stable share link whose access is controlled by visibility.",
    {
      workspaceId: workspaceIdSchema,
      prompt: z.string().min(1).max(2000).describe("What interface to build"),
      kind: z
        .enum(["fixed", "freeform"])
        .optional()
        .describe("'fixed' = React/TSX (default), 'freeform' = raw HTML"),
      targetPath: z
        .string()
        .optional()
        .describe('Folder path to anchor to, e.g. "sales". Omit for root.'),
      visibility: z
        .enum(["private", "public"])
        .optional()
        .describe("Link access; default 'private' (Just me)"),
    },
    (args, extra) =>
      withCaller(extra, async ({ userId }) => {
        const access = await requireAccess(userId, args.workspaceId);

        const target = await resolveFolderByPath(
          args.workspaceId,
          args.targetPath,
        );
        if (!target) {
          return errorResult(`cannot create into "${args.targetPath}"`);
        }
        const targetFolderId = target.id;
        if (!access.canCapture(target.path)) {
          return errorResult("cannot create an artifact in this space");
        }

        const result = await createArtifact(
          {
            prompt: args.prompt,
            kind: args.kind,
            visibility: args.visibility,
          },
          {
            workspaceId: args.workspaceId,
            targetFolderId,
            readScopes: access.scopes("viewer"),
          },
        );
        return jsonResult(
          "Artifact generation started — poll get_artifact until status is 'draft'.",
          {
            artifactId: result.id,
            status: result.status,
            url: result.url,
            visibility: result.visibility,
          },
        );
      }),
  );

  server.tool(
    "get_artifact",
    "Check an artifact's generation status. When ready=true the url renders; otherwise keep polling (or read 'error' if status is 'failed').",
    { workspaceId: workspaceIdSchema, artifactId: z.uuid() },
    (args, extra) =>
      withCaller(extra, async ({ caller }) => {
        const c = await caller.artifact.get({ id: args.artifactId });
        const url = `${env.NIMBASE_WEB_URL}/s/${c.slug}`;
        return jsonResult(`Artifact ${c.status}`, {
          status: c.status,
          ready: c.ready,
          url,
          visibility: c.visibility,
          error: c.error,
        });
      }),
  );

  server.tool(
    "set_artifact_access",
    "Change an artifact's visibility: 'private' (Just me) or 'public' (anyone with the link). The link itself never changes.",
    {
      workspaceId: workspaceIdSchema,
      artifactId: z.uuid(),
      visibility: artifactVisibilitySchema,
    },
    (args, extra) =>
      withCaller(extra, async ({ caller }) => {
        const r = await caller.artifact.setVisibility({
          id: args.artifactId,
          visibility: args.visibility,
        });
        const url = `${env.NIMBASE_WEB_URL}/s/${r.slug}`;
        return jsonResult(`Visibility set to ${r.visibility}`, {
          url,
          visibility: r.visibility,
        });
      }),
  );
}
