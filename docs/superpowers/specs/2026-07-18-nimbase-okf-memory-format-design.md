# OKF memory format — design

**Date:** 2026-07-18
**Status:** Approved (pending spec review)
**Reference:** [OKF v0.1 spec](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)

## Goal

Make workspace memory a conformant **OKF (Open Knowledge Format) v0.1 bundle**: every
stored body is UTF-8 markdown with YAML frontmatter — no JSON serialization anywhere in
the memory system. One editable module defines the schema and the frontmatter ↔ Postgres
mapping; a bi-directional codec is the only code that parses or serializes frontmatter.

Today the system is already close: note bodies are markdown + frontmatter (`title`,
`tags`) in S3 (`workspaces/{workspaceId}/wiki/{versionId}.md`), with `wiki_node` /
`wiki_node_version` / `wiki_node_tag` / `wiki_node_source` as the Postgres index. The
gaps: datasets store **raw JSON bodies** (`kind: "dataset"`, gardener `write_dataset`
tool, `application/json` content-type); frontmatter lacks OKF's required `type` and
recommended `description`/`timestamp`; and frontmatter knowledge is scattered
(`packages/mdx/src/frontmatter.ts`, `title.ts`/`tags.ts` wrappers, an independent
gray-matter parse in `knowledge-graph.ts`).

## Decisions

| Question | Decision |
| --- | --- |
| JSON datasets | Convert to OKF markdown concepts (`type: Dataset`); delete the JSON write path |
| Source of truth | **Frontmatter canonical** — the S3 `.md` body is truth; Postgres is a derived index recomputed on write |
| Schema home | `packages/cloud/src/memory/okf/` (new module: `schema.ts` + `codec.ts`) |
| Migration | Notes upgrade lazily on next write; datasets get a one-off conversion script |
| `sources` field | New frontmatter list, bi-directional with `wiki_node_source` provenance |

## 1. Schema module — `packages/cloud/src/memory/okf/`

The single source of truth for the format. Two files:

### `schema.ts` — what you edit

- `OKF_VERSION = "0.1"`.
- `okfFrontmatterSchema` (Zod): `type` (required non-empty string), `title` (string,
  optional in the schema — write-path policy still requires it for new notes),
  `description` (string), `tags` (string list), `timestamp` (ISO 8601 datetime),
  `sources` (list of `nimbase://source/<uuid>` URIs). `.passthrough()` keeps unknown
  producer keys — OKF §9 forbids rejecting documents for extension keys or unknown types.
- `KNOWN_TYPES`: the editable type vocabulary and its `kind` mapping —
  `Note → "note"`, `Dataset → "dataset"`, `Company Profile → "note"`. Unknown `type`
  values are accepted and map to `kind: "note"` (spec: consumers MUST tolerate unknown
  types). Extend this table to add types; nothing else changes.

### `codec.ts` — the bi-directional parser

- `parseOkf(body)` → `{ meta, content }` via gray-matter, applying defaults (missing
  `type` → `Note`) so legacy bodies parse cleanly.
- `serializeOkf(meta, content)` → deterministic YAML via `matter.stringify` (stable key
  order: `type`, `title`, `description`, `tags`, `timestamp`, `sources`, then extension
  keys). The model never hand-writes YAML — same rule as today.
- `projectToDb(meta)` → `{ title, kind, summary, tags, sourceIds }` for the write seam.
- `frontmatterFromDb(node, version, tags, sources)` → the reverse direction, used by
  UI-originated edits (rename, tag edit) and by reads of legacy bodies.

### Field mapping (frontmatter canonical; DB = derived index)

| Frontmatter | Postgres | Notes |
| --- | --- | --- |
| `type` | `wiki_node.kind` | Via `KNOWN_TYPES`; unknown → `note` |
| `title` | `wiki_node.title` | Existing behavior, now through the codec |
| `description` | `wiki_node_version.summary` | Replaces the summary-only-in-DB split |
| `tags` | `wiki_node_tag` | Existing `reindexTags` recompute, unchanged semantics |
| `timestamp` | stamped from write time; `wiki_node.updated_at` stays the server clock | The one DB→frontmatter field: the codec stamps it at serialize time; authors never set it |
| `sources` | `wiki_node_source` | List of `nimbase://source/<uuid>` URIs; join table recomputed on write like tags. Human-readable citations remain the body's `# Citations` convention |
| extension keys | not indexed | Preserved verbatim in the body; a jsonb column can come later if we ever need to query them |

`sources` URIs are stable identifiers rather than raw URLs so round-tripping is exact;
the future bundle-export feature (NOT-88) can rewrite them to portable links.

## 2. Write path

Every mutation already funnels through `GardenerFs.writeVersion`
(`packages/cloud/src/memory/wiki/vfs.ts:712`). It gains the codec pipeline:
**parse → validate (strict on write) → stamp** (`timestamp`, default `type`, `sources`
union) **→ re-serialize deterministically → persist to S3 → project to DB** (title,
kind, summary, tag reindex, `wiki_node_source` sync) — all in one place.

- **`write_dataset` is deleted**: the gardener tool, the JSON parse/`JSON.stringify`
  round-trip, and the `application/json` content-type branch all go. Every S3 body is
  `text/markdown`. Gardener instructions change: structured data is authored as a
  markdown concept with `type: Dataset` and a markdown table body (OKF's `# Schema`
  convention). `kind: "dataset"` remains as a DB rendering hint, derived from `type`.
- `memoryProvider.upsert` builds full OKF frontmatter (today it only injects `title`
  via `withTitle`). The Biographer's `company.md` gets `type: Company Profile`.
- `cite_sources` (and the compile-time auto-union of `source_id`) writes provenance
  into frontmatter `sources` and lets the projection rebuild `wiki_node_source` —
  frontmatter stays canonical for provenance too.
- `knowledge-graph.ts` drops its independent gray-matter parse for the codec. After
  this change, no code outside `okf/` parses or serializes frontmatter;
  `packages/mdx/src/frontmatter.ts` remains only as the generic gray-matter engine the
  codec calls.
- Write-side validation is strict: unparseable YAML or a missing title on a new note
  rejects the write (existing rule, now enforced by the codec).

## 3. Read path

Reads are permissive (OKF §9): `parseOkf` tolerates missing/invalid frontmatter and
falls back to `frontmatterFromDb` synthesis, so legacy bodies read as full OKF without
being rewritten. The `MemoryNode` DTO gains `type`; `memoryProvider.fetch` stops
hardcoding `kind: "note"`. Read surfaces (`get-note.ts`, tRPC `kb.getNode`, REST
`/api/notes/[id]`, the Memory inspector) surface `type` and `description` from the same
DTO — no new queries.

## 4. Migration

- **Notes: lazy.** Any next write (gardener touch, rename, tag edit, cite) emits full
  OKF frontmatter through the codec. Reads synthesize in the meantime. No mass S3
  rewrite, no version churn.
- **Datasets: one-off script** (few rows): for each live `kind: "dataset"` node, parse
  the JSON body, render it as a markdown concept — frontmatter `type: Dataset` +
  tabular data as a markdown table, non-tabular JSON as a fenced ```json block inside
  the markdown body — and write it as a **new version** through the codec. Append-only
  history preserved; nothing destructive; idempotent (skips nodes whose current version
  body already begins with a `---` frontmatter block).

## 5. Out of scope

Tracked in Linear:

- **NOT-88** — bundle export: synthesized `index.md`/`log.md` (optional reserved files,
  OKF §6/§7) and downloadable bundles. The tree UI is our index for now.
- **NOT-89** — bundle import of external OKF bundles.
- **NOT-90** — first-class `resource` field (canonical asset URI). Until then it flows
  through as an extension key.

## 6. Testing

- **Codec unit tests** (the bulk): round-trip idempotence (`parse → serialize → parse`),
  unknown-key and unknown-type preservation, defaulting on legacy bodies, deterministic
  key order, `sources` URI round-trip, DB projection correctness, strict-write
  rejection cases.
- **VFS tests** updated for the codec pipeline and the removed dataset path.
- **Migration script test** against JSON fixtures (tabular and non-tabular), including
  idempotence on re-run.
- Existing quality gate: typecheck + lint + format + `pnpm turbo test`.
