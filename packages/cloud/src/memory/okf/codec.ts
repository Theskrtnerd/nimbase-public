// The bi-directional OKF codec — the ONLY code allowed to parse or serialize
// memory frontmatter. Every function here is a walk over the FIELDS registry
// in schema.ts; nothing in this file names an individual field, so adding one
// is a registry edit and nothing more.
//
//   read:   S3 body ──parseOkf──▶ meta
//   write:  meta ──stampServerFields──▶ serializeOkf ──▶ S3 body
//                                   └──▶ projectToDb ──▶ Postgres index
//   repair: Postgres ──frontmatterFromDb──▶ meta
//
// Reads are permissive (defaults applied, junk dropped — legacy bodies parse
// as full OKF); strictness is the write path's job.
import matter from "gray-matter";

import type { OkfDbProjection, OkfDbRow, OkfFrontmatter } from "./schema";
import {
  DEFAULT_TYPE,
  FIELDS,
  isDbOwnedKey,
  isKnownKey,
  KEY_ORDER,
  sourceUriFor,
} from "./schema";

export type { OkfDbProjection, OkfDbRow } from "./schema";
export { sourceIdFromUri, sourceUriFor } from "./schema";

export interface ParsedOkf {
  meta: OkfFrontmatter;
  content: string;
  // True when the body opened with its own frontmatter block. Carry-forward
  // logic uses this: a rewrite that declares no frontmatter inherits the
  // previous version's meta instead of silently dropping it.
  declared: boolean;
}

const FRONTMATTER_BLOCK_RE = /^---\r?\n[\s\S]*?\r?\n---/;

// The registry is type-erased by design (specs take and return `unknown`), so
// writes into the typed frontmatter object go through one narrow cast here
// rather than being sprinkled across every walk.
function setField(meta: OkfFrontmatter, key: string, value: unknown): void {
  (meta as Record<string, unknown>)[key] = value;
}

export function parseOkf(body: string): ParsedOkf {
  let data: Record<string, unknown> = {};
  let content = body;
  let declared = false;
  try {
    const parsed = matter(body);
    data = parsed.data as Record<string, unknown>;
    content = parsed.content.replace(/^\r?\n/, "");
    declared = FRONTMATTER_BLOCK_RE.test(body);
  } catch {
    // Malformed YAML — treat the whole body as content (permissive read).
  }

  const meta = { type: DEFAULT_TYPE } as OkfFrontmatter;

  for (const key of KEY_ORDER) {
    const value = FIELDS[key].parse(data[key]);
    if (value !== undefined) setField(meta, key, value);
  }

  // Extension keys ride along untouched — except anything colliding with a
  // DB-owned name, which is dropped so a body can never assert its own path
  // or access grants.
  for (const [key, value] of Object.entries(data)) {
    if (isKnownKey(key) || isDbOwnedKey(key)) continue;
    setField(meta, key, value);
  }

  return { meta, content, declared };
}

export function serializeOkf(meta: OkfFrontmatter, content: string): string {
  const ordered: Record<string, unknown> = {};

  for (const key of KEY_ORDER) {
    const value = meta[key];
    if (value === undefined) continue;
    if (FIELDS[key].isEmpty(value)) continue;
    ordered[key] = value;
  }

  // Extension keys follow in their original order. They get the same
  // empty-value treatment as known keys so that parse → serialize → parse is
  // idempotent for producer extensions too.
  for (const [key, value] of Object.entries(meta)) {
    if (isKnownKey(key) || isDbOwnedKey(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "string" && value.length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    ordered[key] = value;
  }

  return matter.stringify(content, ordered);
}

// Frontmatter → derived Postgres index (wiki_node.title/kind,
// wiki_node_version.summary, wiki_node_tag, wiki_node_source).
export function projectToDb(meta: OkfFrontmatter): OkfDbProjection {
  const out: OkfDbProjection = {
    title: null,
    kind: "note",
    summary: null,
    tags: [],
    sourceIds: [],
  };
  for (const key of KEY_ORDER) {
    const value = meta[key];
    if (value === undefined) continue;
    FIELDS[key].project?.(value, out);
  }
  return out;
}

/**
 * The reverse direction: rebuild frontmatter from the derived index. Used for
 * legacy bodies that never had frontmatter, and as the base object a
 * UI-originated edit mutates before writing back through the VFS.
 *
 * Note this is a *repair* path, not a second source of truth — the result is
 * only ever persisted by writing it back through `writeVersion`, which
 * re-projects it. Fields the DB doesn't index (timestamp, extension keys)
 * come back undefined and are supplied by the write path.
 */
export function frontmatterFromDb(row: OkfDbRow): OkfFrontmatter {
  const meta = { type: DEFAULT_TYPE } as OkfFrontmatter;
  for (const key of KEY_ORDER) {
    const value = FIELDS[key].fromDb?.(row);
    if (value !== undefined) setField(meta, key, value);
  }
  return meta;
}

export interface StampContext {
  /** Title to use when the body declares none. */
  fallbackTitle?: string | null;
  /** Description to use when the body declares none. */
  fallbackDescription?: string | null;
  /** Source id of the compiling job, folded into `sources`. */
  sourceId?: string | null;
  /** Injected for deterministic tests; defaults to now. */
  now?: () => Date;
}

/**
 * Apply the registry's `stamp` policy to a parsed body, in place, immediately
 * before serialization. This is the whole of the server's write-side authority
 * over frontmatter:
 *
 * - `fallback` fields are filled ONLY when the body declares nothing. An
 *   agent-synthesized summary can no longer clobber a human-written
 *   `description` — frontmatter genuinely wins.
 * - `server` fields are overwritten unconditionally.
 * - `union` fields gain the job's source URI without losing any.
 * - `authored` fields are untouched.
 */
export function stampServerFields(
  meta: OkfFrontmatter,
  ctx: StampContext,
): OkfFrontmatter {
  const fallbacks: Partial<Record<string, unknown>> = {
    title: ctx.fallbackTitle ?? undefined,
    description: ctx.fallbackDescription ?? undefined,
  };

  for (const key of KEY_ORDER) {
    const spec = FIELDS[key];
    switch (spec.stamp) {
      case "authored":
        break;
      case "fallback": {
        const declared = meta[key];
        if (declared !== undefined && !spec.isEmpty(declared)) break;
        const value = spec.parse(fallbacks[key]);
        if (value !== undefined) setField(meta, key, value);
        break;
      }
      case "server": {
        const value = spec.parse((ctx.now?.() ?? new Date()).toISOString());
        if (value !== undefined) setField(meta, key, value);
        break;
      }
      case "union": {
        if (!ctx.sourceId) break;
        const existing = meta[key];
        const merged = [
          ...new Set([
            ...(Array.isArray(existing)
              ? existing.filter((v): v is string => typeof v === "string")
              : []),
            sourceUriFor(ctx.sourceId),
          ]),
        ];
        const value = spec.parse(merged);
        if (value !== undefined) setField(meta, key, value);
        break;
      }
    }
  }

  return meta;
}
