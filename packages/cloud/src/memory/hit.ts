import type { SearchHit } from "../search";
import type { MemorySearchResult } from "./provider";

// Flat search-hit projection of a provider `MemorySearchResult` — the wire
// shape every search surface (MCP `search`, REST /api/search, tRPC kb.search)
// has always returned. The search leg puts the best-matching snippet in the
// node's `content`, so that IS the hit's snippet (no per-hit body fetch).
export function toSearchHit(result: MemorySearchResult): SearchHit {
  return {
    nodeId: result.node.id,
    path: result.node.metadata.path,
    title: result.node.title,
    snippet: result.node.content,
    score: result.score,
  };
}
