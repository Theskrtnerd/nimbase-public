/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1)
 * 2. You want to create a new middleware or type of procedure (see Part 3)
 *
 * tl;dr - this is where all the tRPC server stuff is created and plugged in.
 * The pieces you will need to use are documented accordingly near the end
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod/v4";

import type { PathScope } from "@acme/db";
import type { GroupMcpTool, SourceConnectionProvider } from "@acme/db/schema";

import type { WorkspaceBrainInit } from "./lib/workspace-control";
import { requireAccess, resolveGodModeAccess } from "./lib/access";
import { assertGod } from "./lib/operator";

export interface ApiSession {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
}

export interface UserProfile {
  name: string | null;
  email: string | null;
}

// Sends an invitation email (Clerk in production). Returns the provider's
// invitation id, or null when sending failed/was skipped (the invite row
// still works — acceptance matches by email at next sign-in).
export interface InvitePort {
  send: (email: string) => Promise<string | null>;
}

// Enqueues an immediate crawl of a connection, and lists which integration
// providers are configured (needs app-side env). Same injected-port pattern as
// CompilePort so this package stays queue/env-agnostic.
export interface CrawlProviderInfo {
  provider: SourceConnectionProvider;
  label: string;
  configured: boolean;
  scopeKind: string | null;
}
export interface CrawlPort {
  enqueue: (args: {
    connectionId: string;
    workspaceId: string;
  }) => Promise<{ runId: string }>;
  providers: () => CrawlProviderInfo[];
}

// Mints/revokes the ApiTokens backing group MCP endpoints. Minting lives in
// the app (`apps/nextjs/src/server/auth/mint-token.ts`), which `@acme/api`
// cannot import, so it's injected the same way as CompilePort/CrawlPort.
export interface TokenPort {
  mint: (input: {
    workspaceId: string;
    role: "viewer" | "contributor";
    folderId: string | null;
    label: string;
    groupMcpId?: string | null;
  }) => Promise<{ id: string; token: string }>;
  revoke: (tokenId: string) => Promise<void>;
}

// Runs the agentic read-only KB loop that turns an admin's prompt into a
// pre-filled group-MCP `create` payload. Implemented in the app
// (`apps/nextjs/src/server/group-mcp/propose.ts`, calling
// `proposeGroupMcpFromPrompt`), which `@acme/api` cannot import directly, so
// it's injected the same way as TokenPort/CompilePort/CrawlPort.
export interface GroupMcpAIPort {
  propose: (args: {
    workspaceId: string;
    prompt: string;
    readScopes: PathScope[] | null;
  }) => Promise<{
    slug: string;
    name: string;
    instructions: string;
    folderPath: string;
    tools: GroupMcpTool[];
  }>;
}

// Enqueues the day-zero Biographer job that drafts company.md. Implemented
// in the app (QStash in prod, inline in dev) so this package stays
// queue-agnostic — same injected-port pattern as CompilePort/CrawlPort.
export type BrainInitPort = WorkspaceBrainInit;

// Enqueues a documentation-site build. Implemented in the app (QStash in prod,
// inline in dev) so this package stays queue-agnostic — same injected-port
// pattern as CompilePort/CrawlPort.
export interface DocSitePort {
  enqueue: (args: {
    buildId: string;
    docSiteId: string;
    workspaceId: string;
  }) => Promise<void>;
}

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */

export const createTRPCContext = (opts: {
  session: ApiSession | null;
  invites?: InvitePort;
  crawl?: CrawlPort;
  tokens?: TokenPort;
  groupMcpAI?: GroupMcpAIPort;
  brainInit?: BrainInitPort;
  docSites?: DocSitePort;
  // Lazily resolves the caller's email for the god-mode allowlist. Only invoked
  // on operator paths, so hot requests never pay for the Clerk lookup it may do.
  // Defaults to whatever email the session already carries (null for most).
  resolveEmail?: () => Promise<string | null>;
  // Lazily resolves the signed-in user's display profile. Member names are
  // stored as snapshots, but older member rows may predate those columns.
  resolveUserProfile?: () => Promise<UserProfile | null>;
}) => {
  return {
    session: opts.session,
    invites: opts.invites ?? null,
    crawl: opts.crawl ?? null,
    tokens: opts.tokens ?? null,
    groupMcpAI: opts.groupMcpAI ?? null,
    brainInit: opts.brainInit ?? null,
    docSites: opts.docSites ?? null,
    resolveEmail:
      opts.resolveEmail ??
      (() => Promise.resolve(opts.session?.user.email ?? null)),
    resolveUserProfile:
      opts.resolveUserProfile ?? (() => Promise.resolve(null)),
  };
};
/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError
          ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
          : null,
    },
  }),
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an articifial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev 100-500ms
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  if (t._config.isDev) {
    const end = Date.now();
    console.log(`[TRPC] ${path} took ${end - start}ms to execute`);
  }

  return result;
});

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        // infers the `session` as non-nullable
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

/**
 * Workspace-scoped procedure
 *
 * Requires `workspaceId` in the input, resolves the caller's AccessContext once,
 * and attaches it as `ctx.access`. Every workspace-scoped endpoint builds on
 * this instead of calling requireAccess by hand — the permission gate is
 * structural, not per-procedure boilerplate. Admin-only endpoints add
 * `assertAdmin(ctx.access)`; folder-scoped reads use `ctx.access.canRead` /
 * `canManage` / `scopes(...)`.
 */
export const workspaceProcedure = protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .use(async ({ ctx, input, next }) => {
    const access = await requireAccess(ctx.session.user.id, input.workspaceId);
    return next({ ctx: { access } });
  });

/**
 * Operator (god-mode) procedure — read-only support access
 *
 * Requires `workspaceId` in the input and that the caller is a platform god
 * (`GODS` email allowlist). Attaches a full-admin `ctx.access`
 * tagged `viaGodMode: true` WITHOUT any WorkspaceMember row, so support staff
 * can inspect any workspace without being invited. Distinct from
 * `workspaceProcedure` on purpose: this bypass must never back a mutation, so
 * only read queries build on it.
 */
const operatorProcedureBuilder = protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .use(async ({ ctx, input, next }) => {
    assertGod(await ctx.resolveEmail());
    const access = resolveGodModeAccess(ctx.session.user.id, input.workspaceId);
    return next({ ctx: { access } });
  });

// Exposes only `.query` (no `.mutation`) so the read-only guarantee above is
// structural, not just a comment a future endpoint could ignore.
export const operatorProcedure: Pick<typeof operatorProcedureBuilder, "query"> =
  operatorProcedureBuilder;
