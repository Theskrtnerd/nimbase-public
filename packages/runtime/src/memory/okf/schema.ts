// The single editable source of truth for the OKF (Open Knowledge Format)
// memory format: which frontmatter fields exist, how each one is read from
// YAML, written back to YAML, projected into Postgres, and rebuilt from
// Postgres. See docs/superpowers/specs/2026-07-18-nimbase-okf-memory-format-design.md
// and the upstream OKF v0.1 spec.
//
// Adding a field is TWO edits, both in this file: a row in KNOWN_SHAPE (the
// type + serialize order) and a row in FIELDS (the behavior). TypeScript
// fails the build until both exist. codec.ts walks this registry and never
// names a field; nothing outside okf/ touches memory frontmatter at all.
import { z } from "zod/v4";

import { normalizeTags, normalizeTitle } from "./normalize";

export const OKF_VERSION = "0.1";

// Editable type vocabulary. OKF type values are not centrally registered —
// unknown types are valid and map to kind "note" (spec §4.1/§9). Add a row
// here to teach the app a new type; the DB `kind` column is only a rendering
// hint derived from this table.
export const KNOWN_TYPES = {
  Note: "note",
  Dataset: "dataset",
  "Company Profile": "note",
} as const satisfies Record<string, "note" | "dataset">;

export const DEFAULT_TYPE = "Note";

export function kindForType(type: string): "note" | "dataset" {
  return (KNOWN_TYPES as Record<string, "note" | "dataset">)[type] ?? "note";
}

export function typeForKind(kind: "note" | "dataset" | "folder"): string {
  return kind === "dataset" ? "Dataset" : DEFAULT_TYPE;
}

const SOURCE_URI_PREFIX = "nimbase://source/";
// One opaque id segment — no slashes, spaces, or empties. Garbage ids that
// slip through are caught by the join table's FK on the projection sync.
const SOURCE_ID_RE = /^[\w-]+$/;

export function sourceUriFor(id: string): string {
  return `${SOURCE_URI_PREFIX}${id}`;
}

export function sourceIdFromUri(uri: string): string | null {
  if (!uri.startsWith(SOURCE_URI_PREFIX)) return null;
  const id = uri.slice(SOURCE_URI_PREFIX.length);
  return SOURCE_ID_RE.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// The field list
// ---------------------------------------------------------------------------

// OKF v0.1 frontmatter. `type` is the only required field; everything else is
// recommended. Declaration order IS the serialized key order — the
// deterministic-YAML guarantee. Loose object: unknown producer keys MUST be
// preserved, never rejected (OKF §9). `sources` is a Nimbase extension:
// provenance URIs mirroring wiki_node_source.
const KNOWN_SHAPE = {
  type: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  timestamp: z.string().optional(),
  sources: z.array(z.string()).optional(),
};

export const okfFrontmatterSchema = z.looseObject(KNOWN_SHAPE);
export type OkfFrontmatter = z.infer<typeof okfFrontmatterSchema>;
export type KnownKey = keyof typeof KNOWN_SHAPE;

export const KEY_ORDER = Object.keys(KNOWN_SHAPE) as KnownKey[];

export function isKnownKey(key: string): key is KnownKey {
  return Object.prototype.hasOwnProperty.call(KNOWN_SHAPE, key);
}

// ---------------------------------------------------------------------------
// The derived Postgres index
// ---------------------------------------------------------------------------

// What a frontmatter document projects down to. This is the stable contract
// the VFS write path consumes; `project` callbacks below populate it.
export interface OkfDbProjection {
  title: string | null;
  kind: "note" | "dataset";
  summary: string | null;
  tags: string[];
  sourceIds: string[];
}

// The derived index read back the other way, for `frontmatterFromDb`. Mirrors
// the projection plus the columns a body can't own (see `owns: "db"` below).
export interface OkfDbRow {
  title: string | null;
  kind: "note" | "dataset" | "folder";
  summary: string | null;
  tags: string[];
  sourceIds: string[];
}

// ---------------------------------------------------------------------------
// Field behavior
// ---------------------------------------------------------------------------

/**
 * How a field is written on the server side of a version write.
 *
 * - `authored` — the body owns it outright; the server never touches it.
 * - `fallback` — the body owns it, but the server fills a value in when the
 *   body declares none (title from the node, description from the write's
 *   summary). Never overwrites a declared value.
 * - `server`   — the server owns it outright and overwrites on every write
 *   (`timestamp`). Authors cannot set it.
 * - `union`    — the body owns it, and the server folds in additional values
 *   without removing any (`sources` gains the compiling job's source URI).
 */
export type StampMode = "authored" | "fallback" | "server" | "union";

/**
 * Where the field's authority lives.
 *
 * - `frontmatter` — the S3 body is canonical; Postgres is a derived index
 *   recomputed from it on every write and rebuildable by `reproject`.
 * - `db` — Postgres is canonical and the field is NEVER read from a body.
 *   Reserved for facts a body must not be able to assert: `path` (the node's
 *   address, which the permission fence resolves against) and access grants
 *   (writable frontmatter would make composing a body a privilege-escalation
 *   primitive, and the gardener composes bodies from untrusted captured
 *   content). Such fields are hydrated into the read-side object only.
 */
export type Ownership = "frontmatter" | "db";

export interface FieldSpec {
  /** Type + validation. Mirrors this field's entry in KNOWN_SHAPE. */
  zod: z.ZodType;
  owns: Ownership;
  stamp: StampMode;
  /**
   * Permissive read: coerce a raw YAML value into the field's normalized
   * form, or return undefined to omit the field entirely. Never throws —
   * reads tolerate junk (OKF §9); the write path is where strictness lives.
   */
  parse: (raw: unknown) => unknown;
  /** True when the value should be dropped from serialized YAML. */
  isEmpty: (value: unknown) => boolean;
  /** Frontmatter → derived index. Omit for body-only fields. */
  project?: (value: unknown, out: OkfDbProjection) => void;
  /** Derived index → frontmatter, for legacy bodies and UI-originated edits. */
  fromDb?: (row: OkfDbRow) => unknown;
}

function emptyString(value: unknown): boolean {
  return typeof value === "string" && value.length === 0;
}

function emptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function trimmedString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * The behavior table. Exhaustive over KNOWN_SHAPE by construction — a field
 * added to the shape without a row here is a compile error, which is what
 * keeps the two lists from drifting.
 */
export const FIELDS: Record<KnownKey, FieldSpec> = {
  type: {
    zod: KNOWN_SHAPE.type,
    owns: "frontmatter",
    stamp: "authored",
    // The one always-present field: a missing/blank type defaults rather than
    // failing, so legacy bodies parse as full OKF.
    parse: (raw) => trimmedString(raw) ?? DEFAULT_TYPE,
    isEmpty: () => false,
    project: (value, out) => {
      out.kind = kindForType(typeof value === "string" ? value : DEFAULT_TYPE);
    },
    fromDb: (row) => typeForKind(row.kind),
  },

  title: {
    zod: KNOWN_SHAPE.title,
    owns: "frontmatter",
    stamp: "fallback",
    parse: (raw) =>
      typeof raw === "string" ? (normalizeTitle(raw) ?? undefined) : undefined,
    isEmpty: emptyString,
    project: (value, out) => {
      if (typeof value === "string") out.title = value;
    },
    fromDb: (row) =>
      row.title ? (normalizeTitle(row.title) ?? undefined) : undefined,
  },

  description: {
    zod: KNOWN_SHAPE.description,
    owns: "frontmatter",
    stamp: "fallback",
    parse: trimmedString,
    isEmpty: emptyString,
    project: (value, out) => {
      if (typeof value === "string") out.summary = value;
    },
    fromDb: (row) => row.summary ?? undefined,
  },

  tags: {
    zod: KNOWN_SHAPE.tags,
    owns: "frontmatter",
    stamp: "authored",
    parse: (raw) => {
      const tags = normalizeTags(stringArray(raw));
      return tags.length > 0 ? tags : undefined;
    },
    isEmpty: emptyArray,
    project: (value, out) => {
      if (Array.isArray(value))
        out.tags = value.filter((t): t is string => typeof t === "string");
    },
    fromDb: (row) =>
      row.tags.length > 0 ? normalizeTags(row.tags) : undefined,
  },

  timestamp: {
    zod: KNOWN_SHAPE.timestamp,
    owns: "frontmatter",
    stamp: "server",
    parse: (raw) => {
      // js-yaml parses unquoted ISO datetimes into Date objects.
      if (raw instanceof Date) return raw.toISOString();
      return trimmedString(raw);
    },
    isEmpty: emptyString,
    // Not indexed: wiki_node.updated_at is the server clock and stays
    // authoritative for freshness. The body's timestamp records when this
    // version was serialized, which is a different fact.
    fromDb: () => undefined,
  },

  sources: {
    zod: KNOWN_SHAPE.sources,
    owns: "frontmatter",
    stamp: "union",
    parse: (raw) => {
      const uris = [
        ...new Set(stringArray(raw).filter((s) => sourceIdFromUri(s) !== null)),
      ];
      return uris.length > 0 ? uris : undefined;
    },
    isEmpty: emptyArray,
    project: (value, out) => {
      if (!Array.isArray(value)) return;
      out.sourceIds = value
        .filter((s): s is string => typeof s === "string")
        .map(sourceIdFromUri)
        .filter((id): id is string => id !== null);
    },
    fromDb: (row) =>
      row.sourceIds.length > 0 ? row.sourceIds.map(sourceUriFor) : undefined,
  },
};

// ---------------------------------------------------------------------------
// DB-owned fields (read-side only)
// ---------------------------------------------------------------------------

/**
 * Facts the inspector shows that are NOT frontmatter and must never become
 * writable from a body. They are hydrated onto the read-side metadata object
 * so consumers see one uniform shape, but `serializeOkf` never emits them and
 * `parseOkf` ignores them if a body tries to declare them.
 */
export const DB_OWNED_KEYS = ["path", "updatedAt", "access"] as const;
export type DbOwnedKey = (typeof DB_OWNED_KEYS)[number];

export function isDbOwnedKey(key: string): key is DbOwnedKey {
  return (DB_OWNED_KEYS as readonly string[]).includes(key);
}
