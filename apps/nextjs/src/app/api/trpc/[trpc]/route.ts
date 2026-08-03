import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter, createTRPCContext } from "@acme/api";

import { getAuthSession, getSession } from "~/auth/server";
import { clerkInvitePort } from "~/server/auth/accept-invites";
import { brainInitPort } from "~/server/brain/port";
import { crawlPort } from "~/server/crawl/port";
import { docSiteBuildPort } from "~/server/docsite/dispatch";
import { groupMcpAIPort } from "~/server/group-mcp/ai-port";
import { tokensPort } from "~/server/group-mcp/token-port";

/**
 * Configure basic CORS headers
 * You should extend this to match your needs
 */
const setCorsHeaders = (res: Response) => {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Request-Method", "*");
  res.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.headers.set("Access-Control-Allow-Headers", "*");
};

export const OPTIONS = () => {
  const response = new Response(null, {
    status: 204,
  });
  setCorsHeaders(response);
  return response;
};

const handler = async (req: NextRequest) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: async () =>
      createTRPCContext({
        session: await getAuthSession(),
        invites: clerkInvitePort,
        crawl: crawlPort,
        tokens: tokensPort,
        groupMcpAI: groupMcpAIPort,
        brainInit: brainInitPort,
        docSites: docSiteBuildPort,
        // Lazy: only god-gated procedures call this, and getSession is
        // request-cached, so ordinary requests never trigger the Clerk lookup.
        resolveEmail: async () => (await getSession())?.user.email ?? null,
        resolveUserProfile: async () => {
          const user = (await getSession())?.user;
          return user ? { name: user.name, email: user.email } : null;
        },
      }),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error);
    },
  });

  setCorsHeaders(response);
  return response;
};

export { handler as GET, handler as POST };
