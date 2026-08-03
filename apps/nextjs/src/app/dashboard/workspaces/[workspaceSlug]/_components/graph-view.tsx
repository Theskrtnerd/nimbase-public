"use client";

/**
 * Memory graph view — compiled memory as nodes, references as edges.
 * Data-fetching container: runs the kb.graph tRPC query (bodies parsed
 * server-side) and hands the result to the presentational GraphCanvas. Click a
 * node to open it in the Memory view.
 */
import { useQuery } from "@tanstack/react-query";

import type { GraphLink, GraphNode } from "./graph-canvas";
import { useTRPC } from "~/trpc/react";
import { GraphCanvas } from "./graph-canvas";

// Stable empty defaults so GraphCanvas's clone memo doesn't re-run every render
// while the query is pending.
const EMPTY_NODES: GraphNode[] = [];
const EMPTY_LINKS: GraphLink[] = [];

interface GraphViewProps {
  workspaceId: string;
  onOpenNote: (nodeId: string) => void;
}

export function GraphView({ workspaceId, onOpenNote }: GraphViewProps) {
  const trpc = useTRPC();
  const graphQuery = useQuery(trpc.kb.graph.queryOptions({ workspaceId }));

  return (
    <GraphCanvas
      nodes={graphQuery.data?.nodes ?? EMPTY_NODES}
      links={graphQuery.data?.links ?? EMPTY_LINKS}
      truncated={graphQuery.data?.truncated ?? false}
      scannedFileCount={graphQuery.data?.scannedFileCount ?? 0}
      isPending={graphQuery.isPending}
      isError={graphQuery.isError}
      onRefresh={() => void graphQuery.refetch()}
      onOpenNote={onOpenNote}
    />
  );
}
