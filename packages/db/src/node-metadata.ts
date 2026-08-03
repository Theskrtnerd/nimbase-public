import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "./client";
import { mergeSourceRows } from "./node-metadata-merge";
import { Source, WikiNodeSource, WikiNodeTag, WikiNodeVersion } from "./schema";

export type { NodeSourceRef } from "./node-metadata-merge";
export { mergeSourceRows } from "./node-metadata-merge";

const sourceRefColumns = {
  id: Source.id,
  kind: Source.kind,
  title: Source.title,
  sourceUrl: Source.sourceUrl,
  capturedAt: Source.capturedAt,
  createdAt: Source.createdAt,
};

// Provenance for a compiled note: every source it was ever directly compiled
// from (via wiki_node_version.sourceId, auto-stamped on every gardener write)
// unioned with every source explicitly cited onto it (wiki_node_source — the
// gardener's cite_sources tool, plus writeVersion's own auto-union). The
// explicit table is what survives a merge-then-delete: when note B's content
// is merged into note A and B is then rm'd, B's own version history goes with
// it, but sources cited onto A beforehand remain. Newest capture first. Only
// ref fields are selected — never raw S3 keys or metadata blobs.
export async function loadNodeSources(nodeId: string) {
  const [versionRows, citedRows] = await Promise.all([
    db
      .select(sourceRefColumns)
      .from(WikiNodeVersion)
      .innerJoin(Source, eq(Source.id, WikiNodeVersion.sourceId))
      .where(
        and(
          eq(WikiNodeVersion.nodeId, nodeId),
          isNotNull(WikiNodeVersion.sourceId),
        ),
      ),
    db
      .select(sourceRefColumns)
      .from(WikiNodeSource)
      .innerJoin(Source, eq(Source.id, WikiNodeSource.sourceId))
      .where(eq(WikiNodeSource.nodeId, nodeId)),
  ]);

  return mergeSourceRows([...versionRows, ...citedRows]);
}

// The note's tags, read from the derived wiki_node_tag index.
export async function loadNodeTags(nodeId: string): Promise<string[]> {
  const rows = await db
    .select({ tag: WikiNodeTag.tag })
    .from(WikiNodeTag)
    .where(eq(WikiNodeTag.nodeId, nodeId))
    .orderBy(WikiNodeTag.tag);
  return rows.map((r) => r.tag);
}
