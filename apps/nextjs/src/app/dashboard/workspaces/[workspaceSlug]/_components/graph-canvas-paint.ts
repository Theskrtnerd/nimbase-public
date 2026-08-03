/**
 * Pure geometry, palette, and canvas-painting helpers for the knowledge-graph
 * canvas. No React — every function here is a plain module-scope helper the
 * GraphCanvas painters delegate to, so the component keeps only wiring.
 */

// Ocean community palette (hue 248). Nimbase is monochrome by doctrine
// (DESIGN.md §0/§7) — communities are read by ocean lightness, not a
// categorical rainbow. Ordered to alternate deep/light so adjacent communities
// stay distinct. Authored in light values; the global dark-mode invert filter
// handles dark, same as every other surface.
const COMMUNITY_COLORS = [
  "#0C5AA0", // ocean (primary)
  "#6BA4D2", // sky
  "#1C496E", // deep navy
  "#8AA0B4", // ocean slate
  "#0B4775", // deep ocean
  "#3E84C3", // bright sky
  "#0A2A45", // deepest
  "#3F73A8", // mid ocean
  "#123E63", // navy
  "#5E7A95", // slate
] as const;

const FALLBACK_COLOR = "#0C5AA0";

// Always the light palette. Dark mode is the global invert filter
// (@acme/tailwind-config/theme); the canvas is inverted with the rest of the
// page, so there is one set of colors to maintain.
export const THEME_COLORS = {
  ghost: "#8AA0B4",
  linkBase: "rgba(12,90,160,0.18)",
  linkDim: "rgba(12,90,160,0.06)",
  labelFill: "#1B1D24",
  labelStroke: "rgba(255,255,255,0.85)",
} as const;

// Resolve the app's sans family for canvas text. next/font exposes Plus Jakarta
// Sans through the `--font-app-sans` CSS variable (a hashed @font-face name), so
// we read the computed stack off the DOM rather than hardcoding a family the
// canvas can't see. Cached by the caller; falls back on the server.
let cachedSansFamily: string | null = null;
function resolveSansFamily(): string {
  if (cachedSansFamily) return cachedSansFamily;
  if (typeof window === "undefined") {
    return "ui-sans-serif, system-ui, sans-serif";
  }
  cachedSansFamily =
    getComputedStyle(document.body).fontFamily ||
    "ui-sans-serif, system-ui, sans-serif";
  return cachedSansFamily;
}

export interface GraphNode {
  id: string;
  nodeId: string | null;
  title: string;
  folder: string;
  tags: string[];
  degree: number;
  ghost: boolean;
  community: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface FGNode extends GraphNode {
  x?: number;
  y?: number;
}

export interface FGLink {
  source?: string | number | FGNode;
  target?: string | number | FGNode;
}

export function endpointId(end: string | number | FGNode | undefined): string {
  if (typeof end === "string") return end;
  if (typeof end === "number") return String(end);
  if (end && typeof end === "object") return end.id;
  return "";
}

function colorFor(node: GraphNode, ghostColor: string): string {
  if (node.ghost) return ghostColor;
  return (
    COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length] ?? FALLBACK_COLOR
  );
}

export function radiusFor(degree: number): number {
  return 3 + Math.sqrt(degree) * 1.4;
}

export interface HighlightState {
  hoveredId: string | null;
  hoverNeighborSet: Set<string> | null;
  matchSet: Set<string> | null;
  isDimming: boolean;
}

/**
 * Custom node painter — circle + label, sized by degree, colored by community.
 * Ghosts drawn as outlines. Dim non-highlighted when active.
 */
export function paintNode(
  node: FGNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  highlight: HighlightState,
): void {
  const { hoveredId, hoverNeighborSet, matchSet, isDimming } = highlight;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = radiusFor(node.degree);
  const highlighted =
    (hoverNeighborSet?.has(node.id) ?? false) ||
    (matchSet?.has(node.id) ?? false);
  const alpha = isDimming ? (highlighted ? 1 : 0.12) : 1;
  const fill = colorFor(node, THEME_COLORS.ghost);

  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (node.ghost) {
    ctx.lineWidth = 1.5 / globalScale;
    ctx.strokeStyle = fill;
    ctx.stroke();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
    if (hoveredId === node.id) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3 / globalScale, 0, Math.PI * 2);
      ctx.lineWidth = 2 / globalScale;
      ctx.strokeStyle = fill;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
  }

  // Labels: only on highlighted nodes (or always when zoomed in past 2x).
  const showLabel = highlighted || globalScale > 2.2;
  if (showLabel) {
    const fontSize = 12 / globalScale;
    ctx.font = `500 ${String(fontSize)}px ${resolveSansFamily()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3 / globalScale;
    ctx.strokeStyle = THEME_COLORS.labelStroke;
    ctx.strokeText(node.title, x, y + r + 2 / globalScale);
    ctx.fillStyle = THEME_COLORS.labelFill;
    ctx.fillText(node.title, x, y + r + 2 / globalScale);
  }
  ctx.globalAlpha = 1;
}

/** Pointer hit-area painter — a slightly padded disc per node. */
export function paintNodePointerArea(
  node: FGNode,
  color: string,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(node.x ?? 0, node.y ?? 0, radiusFor(node.degree) + 2, 0, Math.PI * 2);
  ctx.fill();
}

/** Link stroke color — dimmed unless both endpoints are highlighted. */
export function linkColorFor(link: FGLink, highlight: HighlightState): string {
  const { hoverNeighborSet, matchSet, isDimming } = highlight;
  const s = endpointId(link.source);
  const t = endpointId(link.target);
  const involved =
    ((hoverNeighborSet?.has(s) ?? false) &&
      (hoverNeighborSet?.has(t) ?? false)) ||
    ((matchSet?.has(s) ?? false) && (matchSet?.has(t) ?? false));
  const dim = isDimming && !involved;
  return dim ? THEME_COLORS.linkDim : THEME_COLORS.linkBase;
}
