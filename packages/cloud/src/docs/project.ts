// Memory → Nimbus content projection.
//
// The deterministic half of docs generation: a fenced slice of memory in, a
// `src/content/docs/**` file tree out. No model call happens here, so the same
// memory always yields the same site and a rebuild is diffable.
//
// Three properties are load-bearing:
//
//  - **`.md`, not `.mdx`.** Nimbus's default glob is `**/*.{md,mdx}`. Memory
//    bodies are arbitrary markdown and routinely contain `<` and `{`, which an
//    MDX parse would treat as JSX and fail the whole build on. Emitting plain
//    markdown makes it impossible for a memory note's content to break a
//    customer's docs site.
//  - **Nimbus-legal frontmatter only.** `docsSchema` is strict — an unknown key
//    is a build error, not a dropped field. OKF's `type`/`tags`/`timestamp`/
//    `sources` are therefore translated or discarded here, never passed through.
//  - **No provenance in the output.** `sources:` carries `nimbase://source/<uuid>`
//    URIs and internal capture trails. A docs site is customer-facing, so
//    provenance stops at this boundary.

import { parseOkf } from "../memory/okf/codec";

/** A memory note that survived the fence, as read from the wiki index. */
export interface MemoryPage {
  /** Full workspace path, e.g. `teams/acme/product/pricing.md`. */
  path: string;
  /** Derived display title from the wiki index (`wiki_node.title`). */
  title: string;
  /** Raw OKF body — frontmatter + markdown. */
  body: string;
}

/**
 * One page of the site, still structured.
 *
 * The pipeline carries this shape all the way through curation and serializes
 * exactly once, at the boundary that writes the bundle. Emitting markdown here
 * and re-parsing it downstream was the earlier design; it meant curation had to
 * regex its own frontmatter back out, which silently corrupted any title
 * containing a quote (`yamlString` escapes them; the regex could not see that).
 * Keeping the model typed makes that class of bug unrepresentable.
 */
export interface DocPage {
  /** Path relative to `src/content/docs/`, always ending in `.md`. */
  path: string;
  title: string;
  description?: string;
  /** Markdown body. Empty means a synthesized index awaiting an overview. */
  body: string;
  sidebarOrder?: number;
}

/** A file to write into the scaffolded Nimbus tree. */
export interface DocsFile {
  /** Path relative to `src/content/docs/`, always ending in `.md`. */
  path: string;
  contents: string;
}

/** Serialize a page to its final `.md` file. The only place this happens. */
export function renderDocPage(page: DocPage): DocsFile {
  return {
    path: page.path,
    contents:
      serializeFrontmatter({
        title: page.title,
        description: page.description,
        sidebarOrder: page.sidebarOrder,
      }) + ensureTrailingNewline(page.body),
  };
}

export interface ProjectOptions {
  /**
   * Fence prefix to strip, e.g. `teams/acme`. Pages outside it are dropped
   * rather than trusted — the caller's fence and this prefix should already
   * agree, and a disagreement means something is wrong upstream.
   */
  fencePrefix: string;
  /** Site title, used for the synthesized root landing page. */
  siteTitle: string;
}

export interface ProjectResult {
  pages: DocPage[];
  /** Number of real memory pages projected (excludes synthesized indexes). */
  pageCount: number;
  /** Paths dropped, with the reason — surfaced in the build log. */
  skipped: { path: string; reason: string }[];
}

/**
 * `company.md` is the root note of every Nimbase memory (written by the
 * Biographer). It is the natural landing page, so it becomes `index.md`
 * rather than a sibling page nobody links to.
 */
const COMPANY_NOTE = "company.md";

/**
 * Reject anything that could escape the content directory once joined. The
 * inputs are our own DB paths, so this is a belt-and-braces check against a
 * malformed path reaching a filesystem write in the build runner.
 */
function isSafeRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  return !path
    .split("/")
    .some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Quote a value for single-line YAML. Always quotes — never guesses. */
export function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Collapse a title to a single line. YAML block scalars would survive a
 * newline, but a multi-line sidebar label never renders usefully.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface Frontmatter {
  title: string;
  description?: string;
  sidebarOrder?: number;
  sidebarLabel?: string;
}

/**
 * Serialize the Nimbus-legal subset. Key order is fixed for diffability.
 * Exported for tests; production code goes through `renderDocPage`.
 */
export function serializeFrontmatter(fm: Frontmatter): string {
  const lines = ["---", `title: ${yamlString(oneLine(fm.title))}`];
  if (fm.description) {
    lines.push(`description: ${yamlString(oneLine(fm.description))}`);
  }
  if (fm.sidebarOrder !== undefined || fm.sidebarLabel) {
    lines.push("sidebar:");
    if (fm.sidebarLabel) {
      lines.push(`  label: ${yamlString(oneLine(fm.sidebarLabel))}`);
    }
    if (fm.sidebarOrder !== undefined) {
      lines.push(`  order: ${fm.sidebarOrder}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Strip the fence prefix and normalize to a content-relative `.md` path.
 * Returns null when the page sits outside the fence.
 */
export function contentPathFor(
  memoryPath: string,
  fencePrefix: string,
): string | null {
  let rel = memoryPath;
  if (fencePrefix) {
    const prefix = fencePrefix.endsWith("/") ? fencePrefix : `${fencePrefix}/`;
    if (memoryPath === fencePrefix) return null;
    if (!memoryPath.startsWith(prefix)) return null;
    rel = memoryPath.slice(prefix.length);
  }
  if (rel === COMPANY_NOTE) return "index.md";
  if (!rel.endsWith(".md")) rel = `${rel}.md`;
  return isSafeRelativePath(rel) ? rel : null;
}

/**
 * Project a fenced set of memory pages into a Nimbus content tree.
 *
 * Pure: no I/O, no clock, no randomness. The curate pass runs *after* this and
 * may fill in bodies and assign `sidebarOrder`, but it starts from these pages.
 */
export function projectDocsContent(
  memoryPages: MemoryPage[],
  options: ProjectOptions,
): ProjectResult {
  const pages: DocPage[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const seen = new Set<string>();
  let pageCount = 0;

  for (const page of memoryPages) {
    const contentPath = contentPathFor(page.path, options.fencePrefix);
    if (!contentPath) {
      skipped.push({ path: page.path, reason: "outside fence or unsafe path" });
      continue;
    }
    if (seen.has(contentPath)) {
      // Two live memory paths cannot collide (unique index), but `company.md`
      // → `index.md` can collide with an authored `index.md`. The authored one
      // already won by arriving first; say so rather than silently dropping.
      skipped.push({ path: page.path, reason: `collides with ${contentPath}` });
      continue;
    }

    const parsed = parseOkf(page.body);
    const title = oneLine(parsed.meta.title ?? page.title);
    if (!title) {
      // docsSchema requires a title; a page without one would fail the build.
      skipped.push({ path: page.path, reason: "no title" });
      continue;
    }

    seen.add(contentPath);
    pageCount += 1;
    pages.push({
      path: contentPath,
      title,
      description: parsed.meta.description,
      body: parsed.content,
    });
  }

  pages.push(...synthesizeGroupIndexes(seen, options.siteTitle));
  pages.sort((a, b) => a.path.localeCompare(b.path));
  return { pages, pageCount, skipped };
}

function ensureTrailingNewline(body: string): string {
  const trimmed = body.replace(/^\n+/, "");
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

/**
 * Nimbus derives sidebar groups from directories, and a group whose directory
 * has no `index.md` renders without a landing page. Every directory therefore
 * gets a stub index if it lacks one — including the site root, so a memory
 * slice with no `company.md` still builds.
 *
 * These are deliberately thin. The curate pass replaces them with real
 * overviews; the stubs only guarantee the build never fails on a missing index.
 */
function synthesizeGroupIndexes(
  existing: Set<string>,
  siteTitle: string,
): DocPage[] {
  const dirs = new Set<string>([""]);
  for (const path of existing) {
    const segments = path.split("/");
    segments.pop();
    for (let i = 1; i <= segments.length; i++) {
      dirs.add(segments.slice(0, i).join("/"));
    }
  }

  const out: DocPage[] = [];
  for (const dir of dirs) {
    const indexPath = dir ? `${dir}/index.md` : "index.md";
    if (existing.has(indexPath)) continue;
    const title = dir
      ? titleizeSegment(dir.split("/").pop() ?? dir)
      : siteTitle;
    // An empty body IS the "needs an overview" signal — no isStub() heuristic.
    out.push({ path: indexPath, title, body: "" });
  }
  return out;
}

/** `getting-started` → `Getting started`. Sentence case, not title case. */
export function titleizeSegment(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ").trim();
  if (!words) return segment;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
