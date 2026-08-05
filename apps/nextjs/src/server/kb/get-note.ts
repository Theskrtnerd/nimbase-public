import "server-only";

import type { AccessContext } from "@acme/api/access";
import { loadNodeSources } from "@acme/api/node-metadata";
import { ToolsetForbiddenError, toProviderContext } from "@acme/runtime/memory";
import { memoryProvider } from "@acme/runtime/memory/wiki-pg-provider";

// Full markdown body for one compiled note, gated on the caller's read
// scopes. Mirrors kb.getNode; shared by the REST route (CLI) and the MCP
// token path so the logic lives once. Returns null for both "doesn't exist"
// and "not readable" — invisible notes must not reveal their existence.
//
// A thin adapter over the MemoryProvider seam: `provider.fetch` does the
// read-scoped node lookup + version/S3 body assembly and carries `summary` +
// `updatedAt`. The richer provenance shape this surface returns
// (kind/title/capturedAt per source) is beyond the provider's lossy SourceRef
// contract, so sources come from the shared `loadNodeSources` helper, fired in
// parallel with the fetch (the sources are simply discarded if the node turns
// out unreadable/missing, so this leaks nothing).
export async function getNoteForAccess(
  access: AccessContext,
  nodeId: string,
): Promise<{
  id: string;
  path: string;
  type: string;
  title: string;
  body: string;
  summary: string | null;
  updatedAt: Date | null;
  tags: string[];
  sources: Awaited<ReturnType<typeof loadNodeSources>>;
} | null> {
  const loaded = await Promise.all([
    memoryProvider.fetch(toProviderContext(access), nodeId),
    loadNodeSources(nodeId),
  ]).catch((err: unknown) => {
    // Empty read scope trips the kernel toolset gate; a principal that "sees
    // nothing" collapses to not-found, exactly like the old empty-scope path.
    if (err instanceof ToolsetForbiddenError) return null;
    throw err;
  });
  if (!loaded) return null;

  const [node, sources] = loaded;
  // Not-found and not-readable collapse: invisible notes never reveal existence.
  if (!node) return null;
  return {
    id: node.id,
    path: node.metadata.path,
    type: node.type ?? "Note",
    title: node.title,
    body: node.content,
    summary: node.summary ?? null,
    updatedAt: node.updatedAt ?? null,
    tags: node.labels,
    sources,
  };
}
