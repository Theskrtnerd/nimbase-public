import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, isNotNull, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode, WikiNodeTag } from "@acme/db/schema";
import { scanReadableGraphInputs } from "@acme/runtime/graph-scan";
import {
  ToolsetForbiddenError,
  toProviderContext,
  toSearchHit,
} from "@acme/runtime/memory";
import { memoryProvider } from "@acme/runtime/memory/wiki-pg-provider";

import { pathScopeWhere } from "../lib/access";
import { buildKnowledgeGraph } from "../lib/knowledge-graph";
import { loadNodeSources } from "../lib/node-metadata";
import { workspaceProcedure } from "../trpc";

export const kbRouter = {
  // Compiled nodes (those with a current version), filtered to the caller's
  // visible subtrees, plus name-only stubs for restricted folders they
  // cannot enter (rendered locked in the tree).
  listCompiledNodes: workspaceProcedure.query(async ({ ctx, input }) => {
    const access = ctx.access;
    const scopeFilter = pathScopeWhere(WikiNode.path, access.scopes("viewer"));
    const nodes = await db
      .select({
        id: WikiNode.id,
        path: WikiNode.path,
        title: WikiNode.title,
        updatedAt: WikiNode.updatedAt,
      })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.workspaceId, input.workspaceId),
          isNotNull(WikiNode.currentVersionId),
          isNull(WikiNode.deletedAt),
          scopeFilter,
        ),
      )
      .orderBy(desc(WikiNode.createdAt));
    const locked = access.isAdmin
      ? []
      : access.restricted
          .filter((path) => !access.canRead(path))
          .map((path) => ({ path }));
    return { nodes, locked };
  }),

  // Hybrid keyword + vector search over the workspace's notes.
  search: workspaceProcedure
    .input(
      z.object({
        query: z.string().max(500),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Through the MemoryProvider seam; mapped back to the flat hit shape
      // (nodeId/path/title/snippet/score) callers have always received.
      const results = await memoryProvider
        .search(toProviderContext(ctx.access), {
          text: input.query,
          limit: input.limit,
        })
        .catch((err: unknown) => {
          // Empty read scope trips the kernel toolset gate; a principal that
          // sees nothing gets an empty result, not a 500.
          if (err instanceof ToolsetForbiddenError) return [];
          throw err;
        });
      return results.map(toSearchHit);
    }),

  // Full body for a single compiled note, gated on the caller's read scopes.
  // A thin adapter over the MemoryProvider seam: `provider.fetch` does the
  // read-scoped lookup + version/S3 body assembly and carries summary +
  // updatedAt in metadata; the richer provenance shape (kind/title/capturedAt
  // per source) is beyond the provider's lossy SourceRef contract, so sources
  // are loaded through the shared `loadNodeSources` helper.
  getNode: workspaceProcedure
    .input(z.object({ nodeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // NOT_FOUND (not FORBIDDEN): invisible notes must not reveal existence.
      const notFound = () =>
        new TRPCError({ code: "NOT_FOUND", message: "Note not found" });

      // fetch + rich provenance in parallel; sources are discarded if the node
      // turns out unreadable/missing, so firing them together leaks nothing.
      const loaded = await Promise.all([
        memoryProvider.fetch(toProviderContext(ctx.access), input.nodeId),
        loadNodeSources(input.nodeId),
      ]).catch((err: unknown) => {
        // Empty read scope trips the kernel toolset gate → sees nothing.
        if (err instanceof ToolsetForbiddenError) return null;
        throw err;
      });
      if (!loaded) throw notFound();

      const [node, sources] = loaded;
      if (!node) throw notFound();
      return {
        id: node.id,
        path: node.metadata.path,
        type: node.type ?? "Note",
        title: node.title,
        body: node.content,
        summary: node.summary ?? null,
        updatedAt: node.updatedAt ?? null,
        sources,
        tags: node.labels,
      };
    }),

  // Tags used across the caller's visible notes, with counts. Path-scoped so
  // tag names never leak the existence of restricted notes.
  listTags: workspaceProcedure.query(async ({ ctx, input }) => {
    const access = ctx.access;
    const scopeFilter = pathScopeWhere(WikiNode.path, access.scopes("viewer"));
    const rows = await db
      .select({ tag: WikiNodeTag.tag })
      .from(WikiNodeTag)
      .innerJoin(WikiNode, eq(WikiNode.id, WikiNodeTag.nodeId))
      .where(
        and(
          eq(WikiNodeTag.workspaceId, input.workspaceId),
          isNull(WikiNode.deletedAt),
          scopeFilter,
        ),
      );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }),

  // Knowledge graph for the workspace: compiled notes as nodes, [[wikilinks]]
  // as edges. Bodies live in S3, so this fetches them on demand and parses
  // links per request. Only nodes within the caller's readable scopes are
  // included; wikilinks pointing at hidden notes are dropped so ghost nodes
  // cannot reveal the existence or title of restricted content.
  graph: workspaceProcedure.query(async ({ ctx, input }) => {
    const access = ctx.access;

    // Readable compiled notes + their S3 bodies, scanned once (shared with the
    // MemoryProvider's neighbors op — MAX_GRAPH_NODES cap and body fan-out live
    // in @acme/runtime/graph-scan).
    const { inputs, truncated } = await scanReadableGraphInputs(
      input.workspaceId,
      access.scopes("viewer"),
    );

    // Build the set of hidden paths so the graph builder can suppress ghost
    // nodes that would otherwise leak restricted note titles. Admins see
    // everything so we skip the extra query for them.
    let hiddenPaths: string[] = [];
    if (!access.isAdmin) {
      const allPaths = await db
        .select({ path: WikiNode.path })
        .from(WikiNode)
        .where(
          and(
            eq(WikiNode.workspaceId, input.workspaceId),
            isNotNull(WikiNode.currentVersionId),
            isNull(WikiNode.deletedAt),
          ),
        );
      hiddenPaths = allPaths
        .map((row) => row.path)
        .filter((path) => !access.canRead(path));
    }

    const { nodes, links } = buildKnowledgeGraph(inputs, { hiddenPaths });

    return { nodes, links, truncated, scannedFileCount: inputs.length };
  }),
} satisfies TRPCRouterRecord;
