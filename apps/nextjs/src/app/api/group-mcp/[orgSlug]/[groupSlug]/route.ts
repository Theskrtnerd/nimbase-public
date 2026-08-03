import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import type { AccessContext } from "@acme/api/access";

import { authorizeApiToken } from "~/server/auth/authorize-workspace";
import {
  loadGroupMcpEndpoint,
  resolveGroupMcpAccess,
} from "~/server/group-mcp/resolve-access";
import { registerGroupMcpTools } from "~/server/group-mcp/tools";

interface RouteParams {
  params: Promise<{ orgSlug: string; groupSlug: string }>;
}

// Each tool handler reads the per-request fenced AccessContext the verify
// callback stashed in authInfo.extra. Throwing here yields an error result
// via the tool's guard() envelope.
function readAccess(extra: unknown): AccessContext {
  const info = (extra as { authInfo?: { extra?: Record<string, unknown> } })
    .authInfo?.extra;
  const access = info?.groupMcpAccess;
  if (!access) throw new Error("Unauthorized");
  return access as AccessContext;
}

async function handle(req: Request, orgSlug: string, groupSlug: string) {
  const endpoint = await loadGroupMcpEndpoint(orgSlug, groupSlug);
  if (!endpoint) return new Response("Not found", { status: 404 });

  // mcp-handler routes internally by exact `url.pathname === streamableHttpEndpoint`
  // (default "/mcp"). This route is mounted at /api/group-mcp/<org>/<group> (and
  // reached via the subdomain rewrite), so without this the handler 404s every
  // request before any tool runs. Derive the endpoint from THIS request's own
  // pathname so it matches by construction, whether hit directly or via rewrite.
  const streamableHttpEndpoint = new URL(req.url).pathname;

  const handler = withMcpAuth(
    createMcpHandler(
      (server) => {
        registerGroupMcpTools(server as never, readAccess, endpoint.tools, {
          folderId: endpoint.folderId,
          folderPath: endpoint.folderPath,
          artifactVisibility: endpoint.artifactVisibility,
        });
      },
      undefined,
      { streamableHttpEndpoint },
    ),
    async (_r, token) => {
      // A Clerk OAuth token and an ApiToken both arrive as a Bearer header.
      // Only attempt Clerk verification when it isn't one of our ApiTokens
      // (mirrors the shared MCP route's order). resolveGroupMcpAccess makes
      // the final api-key-vs-oauth decision and fences the returned access.
      let clerkUserId: string | null = null;
      if (token) {
        const apiTokenAuthz = await authorizeApiToken(`Bearer ${token}`);
        if (!apiTokenAuthz) {
          const clerkAuth = await auth({ acceptsToken: "oauth_token" });
          const verified = verifyClerkToken(clerkAuth, token);
          if (verified) clerkUserId = clerkAuth.userId ?? null;
        }
      }
      const result = await resolveGroupMcpAccess({
        endpoint,
        authorizationHeader: token ? `Bearer ${token}` : null,
        clerkUserId,
      });
      if (!result.ok) return undefined;
      return {
        token: token ?? "",
        clientId: "nimbase-group-mcp",
        scopes: [],
        extra: { groupMcpAccess: result.access },
      };
    },
    { required: true },
  );
  return handler(req);
}

export async function GET(req: Request, { params }: RouteParams) {
  const { orgSlug, groupSlug } = await params;
  return handle(req, orgSlug, groupSlug);
}

export async function POST(req: Request, { params }: RouteParams) {
  const { orgSlug, groupSlug } = await params;
  return handle(req, orgSlug, groupSlug);
}
