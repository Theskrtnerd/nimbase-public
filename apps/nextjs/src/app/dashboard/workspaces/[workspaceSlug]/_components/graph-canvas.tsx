"use client";

/**
 * Presentational knowledge-graph canvas — pure rendering, no data fetching.
 * Given nodes + links (and load state), it draws the force-directed graph with
 * react-force-graph-2d: degree-sized nodes, Louvain community colors, ghost
 * outlines, search filter, hover-neighbor highlight, and the overlay chrome.
 * GraphView feeds it from the kb.graph query; it can also be driven directly
 * with sample data.
 *
 * Geometry/palette/painting live in `graph-canvas-paint.ts`, sizing + highlight
 * derivations in `use-graph-canvas.ts`, and the overlay chrome in
 * `graph-canvas-overlays.tsx`.
 */
import type ForceGraph2DComponent from "react-force-graph-2d";
import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import type {
  FGLink,
  FGNode,
  GraphLink,
  GraphNode,
} from "./graph-canvas-paint";
import {
  GraphControls,
  GraphCounts,
  GraphEmptyOverlay,
  GraphErrorOverlay,
  GraphHoverCard,
  GraphLoadingOverlay,
} from "./graph-canvas-overlays";
import {
  linkColorFor,
  paintNode,
  paintNodePointerArea,
} from "./graph-canvas-paint";
import { useElementSize, useGraphHighlight } from "./use-graph-canvas";

export type { GraphLink, GraphNode } from "./graph-canvas-paint";

// react-force-graph-2d touches `window`, so it must load client-only. The
// double cast bridges next/dynamic's loadable type back to the library's
// generic component type so we can pass <ForceGraph2D<GraphNode> …>.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as typeof ForceGraph2DComponent;

interface GraphCanvasProps {
  nodes: GraphNode[];
  links: GraphLink[];
  truncated: boolean;
  scannedFileCount: number;
  isPending: boolean;
  isError: boolean;
  onRefresh: () => void;
  onOpenNote: (nodeId: string) => void;
}

export function GraphCanvas({
  nodes,
  links,
  truncated,
  scannedFileCount,
  isPending,
  isError,
  onRefresh,
  onOpenNote,
}: GraphCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const size = useElementSize(wrapperRef);

  // Stable, mutable copy for the force simulation: react-force-graph mutates
  // node x/y and rewrites link endpoints to node refs in place. Re-clone only
  // when the source data changes, so hover/search re-renders don't reset the
  // layout.
  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    }),
    [nodes, links],
  );

  const highlight = useGraphHighlight(
    graphData.nodes,
    graphData.links,
    search,
    hoveredId,
  );

  const drawNode = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      paintNode(node, ctx, globalScale, highlight);
    },
    [highlight],
  );

  const linkColor = useCallback(
    (link: FGLink) => linkColorFor(link, highlight),
    [highlight],
  );

  const handleNodeClick = useCallback(
    (node: FGNode) => {
      if (!node.ghost && node.nodeId) onOpenNote(node.nodeId);
    },
    [onOpenNote],
  );

  const handleNodeHover = useCallback((node: FGNode | null) => {
    setHoveredId(node ? node.id : null);
  }, []);

  const hoveredNode = useMemo(() => {
    if (!hoveredId) return null;
    return graphData.nodes.find((n) => n.id === hoveredId) ?? null;
  }, [hoveredId, graphData.nodes]);

  const isEmpty = !isPending && !isError && graphData.nodes.length === 0;

  return (
    <div
      ref={wrapperRef}
      className="bg-background relative h-full w-full overflow-hidden"
    >
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D<GraphNode>
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={4}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintNodePointerArea}
          linkColor={linkColor}
          linkWidth={1}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          cooldownTicks={200}
          d3VelocityDecay={0.35}
        />
      )}

      <GraphControls
        search={search}
        onSearchChange={setSearch}
        onRefresh={onRefresh}
      />

      <GraphCounts
        nodeCount={graphData.nodes.length}
        linkCount={graphData.links.length}
        truncated={truncated}
        scannedFileCount={scannedFileCount}
      />

      {isPending && <GraphLoadingOverlay />}
      {isError && <GraphErrorOverlay />}
      {isEmpty && <GraphEmptyOverlay />}
      {hoveredNode && <GraphHoverCard node={hoveredNode} />}
    </div>
  );
}
