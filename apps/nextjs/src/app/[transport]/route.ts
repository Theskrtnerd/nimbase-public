import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { authorizeApiToken } from "~/server/auth/authorize-workspace";
import { registerNimbaseTools } from "~/server/mcp/tools";

const handler = createMcpHandler((server) => {
  registerNimbaseTools(server);
});

// Two bearer principals share the MCP transport:
//   1. a folder-scoped ApiToken — external integrations connecting to the KB.
//      Tried first (cheap hash lookup, no Clerk
//      roundtrip); tools re-verify per call so revocation is immediate.
//   2. a Clerk OAuth token — workspace members (full tool set).
const authHandler = withMcpAuth(
  handler,
  async (_req, token) => {
    if (token) {
      const tokenAuthz = await authorizeApiToken(`Bearer ${token}`);
      if (tokenAuthz) {
        return {
          token,
          clientId: "nimbase-api-token",
          scopes: [],
          extra: { apiTokenAuthorization: `Bearer ${token}` },
        };
      }
    }
    const clerkAuth = await auth({ acceptsToken: "oauth_token" });
    return verifyClerkToken(clerkAuth, token);
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
  },
);

export { authHandler as GET, authHandler as POST };
