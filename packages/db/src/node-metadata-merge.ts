// Pure merge/sort logic for loadNodeSources, split out of node-metadata.ts
// so it's importable (and unit-testable) without pulling in @acme/db/client,
// which throws eagerly when POSTGRES_URL is unset.
export interface NodeSourceRef {
  id: string;
  kind: string;
  title: string | null;
  sourceUrl: string | null;
  capturedAt: Date | null;
}

export interface SourceRow {
  id: string;
  kind: string;
  title: string | null;
  sourceUrl: string | null;
  capturedAt: Date | null;
  createdAt: Date;
}

// Dedup by source id (first occurrence wins — fields don't vary across
// duplicates of the same source) and sort newest-capture-first, falling back
// to the source's own createdAt when it was never explicitly captured.
export function mergeSourceRows(rows: SourceRow[]): NodeSourceRef[] {
  const byId = new Map<string, { ref: NodeSourceRef; sort: number }>();
  for (const r of rows) {
    if (byId.has(r.id)) continue;
    byId.set(r.id, {
      ref: {
        id: r.id,
        kind: r.kind,
        title: r.title,
        sourceUrl: r.sourceUrl,
        capturedAt: r.capturedAt,
      },
      sort: (r.capturedAt ?? r.createdAt).getTime(),
    });
  }
  return [...byId.values()].sort((a, b) => b.sort - a.sort).map((v) => v.ref);
}
