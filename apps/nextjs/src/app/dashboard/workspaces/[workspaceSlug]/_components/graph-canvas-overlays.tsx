"use client";

/**
 * Overlay chrome drawn on top of the knowledge-graph canvas: the search +
 * refresh bar, the node/edge counts, the loading / error / empty states, and
 * the hover tooltip. Each piece is presentational and stateless.
 */
import { LoaderIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import type { GraphNode } from "./graph-canvas-paint";

export function GraphControls({
  search,
  onSearchChange,
  onRefresh,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="absolute top-3 left-3 flex items-center gap-2">
      <div className="bg-background/80 border-border flex items-center gap-2 rounded-lg border px-3 py-1.5 backdrop-blur-md">
        <SearchIcon className="text-muted-foreground size-3.5" />
        <input
          aria-label="Filter memory graph"
          type="text"
          placeholder="Filter memory…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="placeholder:text-muted-foreground w-48 bg-transparent text-sm outline-none"
        />
      </div>
      <button
        aria-label="Rebuild graph"
        type="button"
        onClick={onRefresh}
        title="Rebuild graph"
        className="bg-background/80 border-border hover:bg-accent flex size-8 items-center justify-center rounded-lg border backdrop-blur-md"
      >
        <RefreshCwIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function GraphCounts({
  nodeCount,
  linkCount,
  truncated,
  scannedFileCount,
}: {
  nodeCount: number;
  linkCount: number;
  truncated: boolean;
  scannedFileCount: number;
}) {
  return (
    <div className="text-muted-foreground absolute bottom-3 left-3 flex gap-3 text-xs tabular-nums">
      <span>{nodeCount} nodes</span>
      <span>{linkCount} edges</span>
      {truncated && <span>showing first {scannedFileCount} memories</span>}
    </div>
  );
}

export function GraphLoadingOverlay() {
  return (
    <div className="bg-background/60 pointer-events-none absolute inset-0 flex items-center justify-center backdrop-blur-sm">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderIcon className="size-4 animate-spin" />
        Building graph…
      </div>
    </div>
  );
}

export function GraphErrorOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-muted-foreground max-w-md text-center text-sm">
        Couldn&apos;t build the graph. Try refreshing.
      </div>
    </div>
  );
}

export function GraphEmptyOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-muted-foreground max-w-md space-y-1 text-center">
        <div className="text-foreground text-base">No connections yet</div>
        <div className="text-sm">
          As your sources compile into memory and reference each other, the
          relationships map out here.
        </div>
      </div>
    </div>
  );
}

export function GraphHoverCard({ node }: { node: GraphNode }) {
  return (
    <div className="bg-background/90 border-border pointer-events-none absolute right-3 bottom-3 max-w-sm rounded-lg border px-3 py-2 backdrop-blur-md">
      <div className="text-foreground text-sm font-medium">{node.title}</div>
      <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs">
        <span>{node.degree} links</span>
        {node.tags.length > 0 && (
          <span>· {node.tags.map((t) => `#${t}`).join(" ")}</span>
        )}
        {node.ghost && <span>· unresolved</span>}
      </div>
    </div>
  );
}
