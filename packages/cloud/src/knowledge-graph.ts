/**
 * Pure knowledge-graph builder for the cloud KB. Given compiled notes (path +
 * markdown body), extracts [[wikilinks]] as edges, resolves them to nodes,
 * marks unresolved targets as ghosts, and computes degree + Louvain
 * communities. Decoupled from the filesystem so it can run server-side over
 * S3 bodies.
 */

import Graph from "graphology";
import louvain from "graphology-communities-louvain";

import { parseOkf } from "./memory/okf/codec";

export interface GraphInputNote {
  /** WikiNode uuid — used by the client to open the note. */
  nodeId: string;
  /** Workspace-relative path, e.g. "docs/foo/my-note". Graph identity. */
  path: string;
  /** Markdown body fetched from S3. */
  body: string;
  /** WikiNode.title — every real note has one (required at creation). */
  title: string;
}

export interface KbGraphNode {
  /** Workspace-relative path — the node's graph identity and resolution key. */
  id: string;
  /** WikiNode uuid to open, or null for ghost (unresolved-link) nodes. */
  nodeId: string | null;
  /** Display name derived from the path. */
  title: string;
  /** Folder portion of `id` ("" for root-level notes). */
  folder: string;
  tags: string[];
  /** Total degree. Filled after edges are added. */
  degree: number;
  /** True if referenced by a wikilink but no matching note exists. */
  ghost: boolean;
  /** Louvain community id. */
  community: number;
}

export interface KbGraphLink {
  source: string;
  target: string;
}

export interface KbGraph {
  nodes: KbGraphNode[];
  links: KbGraphLink[];
}

interface ParsedNote {
  nodeId: string;
  id: string;
  title: string;
  folder: string;
  tags: string[];
  links: string[];
}

// graphology ships permissive types; wrap the slice we use so this file stays
// free of `any` and typechecks against a stable shape.
interface GraphInstance {
  readonly order: number;
  addNode: (id: string, attrs: KbGraphNode) => void;
  addEdge: (source: string, target: string) => void;
  hasNode: (id: string) => boolean;
  hasEdge: (source: string, target: string) => boolean;
  degree: (id: string) => number;
  setNodeAttribute: <K extends keyof KbGraphNode>(
    id: string,
    key: K,
    value: KbGraphNode[K],
  ) => void;
  forEachNode: (callback: (node: string, attrs: KbGraphNode) => void) => void;
  forEachEdge: (
    callback: (
      edge: string,
      attrs: unknown,
      source: string,
      target: string,
    ) => void,
  ) => void;
}

type GraphConstructor = new (options: {
  type: "undirected";
  multi: boolean;
  allowSelfLoops: boolean;
}) => GraphInstance;

type LouvainRunner = (graph: GraphInstance) => Record<string, number>;

const GraphCtor = Graph as unknown as GraphConstructor;
const runLouvain = louvain as unknown as LouvainRunner;

function folderOf(id: string): string {
  const index = id.lastIndexOf("/");
  return index === -1 ? "" : id.slice(0, index);
}

function stripExt(path: string): string {
  return path.replace(/\.(mdx?|MDX?)$/, "");
}

// Ghost nodes (unresolved [[wikilink]] targets) have no WikiNode row, so
// there's no title to read — this is the only place a label is still
// derived from a path string. Not used for real notes, which always carry a
// title set at creation (see @acme/cloud/memory/wiki vfs.ts write()).
function ghostLabel(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? path;
  const spaced = last.replace(/[-_]/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Replace a span with spaces of equal length so positional offsets stay stable
// for downstream regex passes — we only need to neutralize wikilink-looking
// content, not remove characters.
function blankRange(input: string, start: number, end: number): string {
  return (
    input.slice(0, start) +
    input.slice(start, end).replace(/[^\n]/g, " ") +
    input.slice(end)
  );
}

interface LineSpan {
  start: number;
  end: number;
  text: string;
}

function lineSpans(input: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  while (start < input.length) {
    const newline = input.indexOf("\n", start);
    const end = newline === -1 ? input.length : newline + 1;
    let textEnd = newline === -1 ? input.length : newline;
    if (textEnd > start && input[textEnd - 1] === "\r") textEnd--;
    spans.push({ start, end, text: input.slice(start, textEnd) });
    start = end;
  }
  return spans;
}

function fenceStart(line: string): { indent: string; marker: string } | null {
  let markerStart = 0;
  while (line[markerStart] === " " || line[markerStart] === "\t") {
    markerStart++;
  }
  const markerChar = line[markerStart];
  if (markerChar !== "`" && markerChar !== "~") return null;

  let markerEnd = markerStart;
  while (line[markerEnd] === markerChar) markerEnd++;
  if (markerEnd - markerStart < 3) return null;
  return {
    indent: line.slice(0, markerStart),
    marker: line.slice(markerStart, markerEnd),
  };
}

function isFenceEnd(
  line: string,
  fence: { indent: string; marker: string },
): boolean {
  const prefix = fence.indent + fence.marker;
  if (!line.startsWith(prefix)) return false;
  for (const char of line.slice(prefix.length)) {
    if (char !== " " && char !== "\t") return false;
  }
  return true;
}

function blankInlineCode(line: string): string {
  const chars = [...line];
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      cursor++;
      continue;
    }

    let markerEnd = cursor;
    while (line[markerEnd] === "`") markerEnd++;
    const marker = line.slice(cursor, markerEnd);
    let close = line.indexOf(marker, markerEnd);
    while (
      close !== -1 &&
      (line[close - 1] === "`" || line[close + marker.length] === "`")
    ) {
      close = line.indexOf(marker, close + 1);
    }
    if (close === -1) {
      cursor = markerEnd;
      continue;
    }

    for (let index = cursor; index < close + marker.length; index++) {
      chars[index] = " ";
    }
    cursor = close + marker.length;
  }
  return chars.join("");
}

// Strip regions where `[[...]]` is not a real wikilink in the rendered note:
// frontmatter, fenced/indented code blocks, and inline code spans. The remark
// pipeline only transforms `text` AST nodes, so wikilinks inside code never
// become note links — mirror that here.
function stripNonTextSpans(source: string): string {
  let out = source;

  const spans = lineSpans(out);
  if (spans[0]?.text === "---") {
    const closing = spans.slice(1).find((span) => span.text === "---");
    if (closing) out = blankRange(out, 0, closing.end);
  }

  let openFence: { start: number; indent: string; marker: string } | undefined;
  for (const span of lineSpans(out)) {
    if (openFence) {
      if (isFenceEnd(span.text, openFence)) {
        out = blankRange(out, openFence.start, span.end);
        openFence = undefined;
      }
      continue;
    }
    const fence = fenceStart(span.text);
    if (fence) openFence = { start: span.start, ...fence };
  }

  return lineSpans(out)
    .map((span) => blankInlineCode(out.slice(span.start, span.end)))
    .join("");
}

function extractWikilinks(source: string): string[] {
  const cleaned = stripNonTextSpans(source);
  const out: string[] = [];
  let cursor = 0;
  while (cursor < cleaned.length) {
    const start = cleaned.indexOf("[[", cursor);
    if (start === -1) break;
    const end = cleaned.indexOf("]]", start + 2);
    if (end === -1) break;
    cursor = end + 2;

    // Skip escaped wikilinks like \[\[foo\]\] — these render as literal text.
    if (start > 0 && cleaned[start - 1] === "\\") continue;
    const raw = cleaned.slice(start + 2, end).trim();
    if (!raw) continue;
    const pipe = raw.indexOf("|");
    const target = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
    if (target) out.push(target);
  }
  return out;
}

function tagsFromBody(body: string): string[] {
  // The OKF codec is permissive (malformed frontmatter → no tags), so the
  // graph never needs its own parse.
  return parseOkf(body).meta.tags ?? [];
}

function parseNote(note: GraphInputNote): ParsedNote {
  const id = stripExt(note.path);
  return {
    nodeId: note.nodeId,
    id,
    title: note.title,
    folder: folderOf(id),
    tags: tagsFromBody(note.body),
    links: extractWikilinks(note.body),
  };
}

function resolveTarget(
  raw: string,
  byId: Map<string, ParsedNote>,
  byBasename: Map<string, ParsedNote[]>,
): string | null {
  const target = raw.trim();
  if (!target) return null;
  if (byId.has(target)) return target;

  const cleaned = stripExt(target.replace(/^\/+/, ""));
  if (byId.has(cleaned)) return cleaned;

  const basename = cleaned.split("/").pop() ?? cleaned;
  const candidates = byBasename.get(basename.toLowerCase());
  const first = candidates?.[0];
  return first?.id ?? null;
}

/**
 * Build the knowledge graph from compiled notes. Pure — no IO. The query layer
 * is responsible for fetching bodies and for truncation bookkeeping.
 *
 * @param opts.hiddenPaths - Workspace-relative paths the viewer cannot read.
 *   When an unresolved link target matches a hidden path (by full cleaned path
 *   or by lowercased basename), the link is dropped entirely — no ghost node is
 *   created, so the hidden note's title is never revealed.
 */
export function buildKnowledgeGraph(
  notes: GraphInputNote[],
  opts?: { hiddenPaths?: string[] },
): KbGraph {
  const parsed = notes.map(parseNote);

  const byId = new Map<string, ParsedNote>();
  const byBasename = new Map<string, ParsedNote[]>();
  for (const note of parsed) {
    byId.set(note.id, note);
    const basename = (note.id.split("/").pop() ?? note.id).toLowerCase();
    const entries = byBasename.get(basename) ?? [];
    entries.push(note);
    byBasename.set(basename, entries);
  }

  // Build hidden-path lookup sets from caller-supplied paths (extensions stripped).
  const hiddenIds = new Set((opts?.hiddenPaths ?? []).map(stripExt));
  const hiddenBasenames = new Set(
    [...hiddenIds].map((p) => (p.split("/").pop() ?? p).toLowerCase()),
  );

  const graph = new GraphCtor({
    type: "undirected",
    multi: false,
    allowSelfLoops: false,
  });

  for (const note of parsed) {
    graph.addNode(note.id, {
      id: note.id,
      nodeId: note.nodeId,
      title: note.title,
      folder: note.folder,
      tags: note.tags,
      degree: 0,
      ghost: false,
      community: 0,
    });
  }

  for (const note of parsed) {
    for (const raw of note.links) {
      const targetId = resolveTarget(raw, byId, byBasename);

      // The target exists but the viewer cannot see it — drop the link
      // entirely; a ghost node would leak the hidden note's title.
      if (targetId === null) {
        // Normalize the same shapes ghostLabel collapses when naming a
        // ghost — #fragment, trailing slashes, extension — so links like
        // [[hidden/]], [[hidden.md/]], or [[hidden#section]] cannot bypass
        // suppression and leak the hidden note's title.
        const noFragment = raw.trim().split("#")[0] ?? "";
        const cleaned = stripExt(
          noFragment.replace(/^\/+/, "").replace(/\/+$/, ""),
        );
        const basename = (
          cleaned.split("/").filter(Boolean).pop() ?? cleaned
        ).toLowerCase();
        if (hiddenIds.has(cleaned) || hiddenBasenames.has(basename)) continue;
      }

      const finalTarget = targetId ?? raw.trim();

      if (!graph.hasNode(finalTarget)) {
        graph.addNode(finalTarget, {
          id: finalTarget,
          nodeId: null,
          title: ghostLabel(finalTarget),
          folder: folderOf(finalTarget),
          tags: [],
          degree: 0,
          ghost: true,
          community: 0,
        });
      }

      if (note.id === finalTarget) continue;
      if (!graph.hasEdge(note.id, finalTarget)) {
        graph.addEdge(note.id, finalTarget);
      }
    }
  }

  graph.forEachNode((node) => {
    graph.setNodeAttribute(node, "degree", graph.degree(node));
  });

  if (graph.order > 0) {
    try {
      const assignments = runLouvain(graph);
      for (const [node, community] of Object.entries(assignments)) {
        graph.setNodeAttribute(node, "community", community);
      }
    } catch {
      // Louvain throws on disconnected graphs in some versions; default to 0.
    }
  }

  const nodes: KbGraphNode[] = [];
  graph.forEachNode((_, attrs) => nodes.push(attrs));
  const links: KbGraphLink[] = [];
  graph.forEachEdge((_, __, source, target) => {
    links.push({ source, target });
  });

  return { nodes, links };
}
