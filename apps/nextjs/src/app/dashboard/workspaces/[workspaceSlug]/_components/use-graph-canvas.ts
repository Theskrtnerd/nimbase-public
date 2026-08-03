"use client";

/**
 * Interaction/measurement hooks for the knowledge-graph canvas: element sizing
 * for the canvas' explicit pixel dimensions, and the hover/search highlight
 * derivations the painters read.
 */
import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";

import type { FGLink, FGNode, HighlightState } from "./graph-canvas-paint";
import { endpointId } from "./graph-canvas-paint";

export interface Size {
  width: number;
  height: number;
}

/**
 * Track an element's size for ForceGraph2D's width/height props.
 * Effect justified: ResizeObserver is imperative and the canvas needs
 * explicit pixel dimensions.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}

/**
 * Search match set + neighbor map for hover-highlight, folded into the single
 * `HighlightState` the node/link painters consume.
 */
export function useGraphHighlight(
  nodes: FGNode[],
  links: FGLink[],
  search: string,
  hoveredId: string | null,
): HighlightState {
  const matchSet = useMemo(() => {
    if (!search.trim()) return null;
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const set = new Set<string>();
    for (const n of nodes) {
      if (re.test(n.title) || re.test(n.id) || n.tags.some((t) => re.test(t)))
        set.add(n.id);
    }
    return set;
  }, [search, nodes]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const ensure = (id: string): Set<string> => {
      let set = map.get(id);
      if (!set) {
        set = new Set();
        map.set(id, set);
      }
      return set;
    };
    for (const link of links) {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      ensure(s).add(t);
      ensure(t).add(s);
    }
    return map;
  }, [links]);

  const hoverNeighborSet = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set<string>([hoveredId]);
    const ns = neighbors.get(hoveredId);
    if (ns) for (const n of ns) set.add(n);
    return set;
  }, [hoveredId, neighbors]);

  return useMemo(
    () => ({
      hoveredId,
      hoverNeighborSet,
      matchSet,
      isDimming: hoveredId !== null || matchSet !== null,
    }),
    [hoveredId, hoverNeighborSet, matchSet],
  );
}
