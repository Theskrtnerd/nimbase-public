# Memory kernel architecture

Nimbase is **memory infrastructure for companies** — a
permissioned company-memory layer that captures, structures, governs, and serves
organizational memory to humans and AI systems. The product loop is
**capture → compile → share**:

- **Capture** — the CLI, API, and MCP `capture` tool send source evidence to
  ingest; binaries normalize to markdown.
- **Compile** — the gardener structures captures into memory nodes (`WikiNode`),
  fenced to a target folder.
- **Identity** — `UserProfile` is the stable employee record. Provider subjects
  bind to it first; an exact verified email may join another source identity.
- **Govern** — provider sources carry immutable ACL snapshots and remain held
  outside compiled memory until the compiler can preserve later policy changes
  and pass security evals.
- **Share** — search, memory graph, artifacts, MCP, docs, widgets, and
  chat-platform agents. Deployments default to the KB root and may optionally
  narrow themselves to a folder.

## The MemoryProvider seam

Today, memory access is direct Drizzle SQL scattered across several call sites
(`packages/runtime/src/search.ts`, `apps/nextjs/src/server/kb/*`,
`packages/api/src/router/kb.ts`, `server/compile/vfs.ts`). There is exactly one
backing implementation — a wiki/Postgres store that fuses an LLM-navigated
folder tree (`WikiNode` + versioned `WikiNodeVersion` bodies in S3) with
vector + full-text retrieval (pgvector HNSW, fused via RRF).

The **MemoryProvider seam** collapses those call sites behind one stable
interface so the backend stays swappable and callers depend only on the
contract. It lives in **`@acme/runtime/src/memory/`**:

- `node.ts` — `MemoryNode`, the format-agnostic contract DTO (NOT the Drizzle
  row), plus `SourceRef`/`Span` provenance types.
- `context.ts` — the branded `ProviderAccessContext` and its only constructor
  `toProviderContext`, toolset derivation, and toolset-assertion helpers.
- `provider.ts` — the `MemoryProvider` interface (all seven ops + a
  `capabilities` set), op→toolset mapping, and per-op assertion helper.

This ticket (NOT-57) defines the **seam only** — types plus the access-context
mapper and pure assertion helpers. No call-site migration, no DB access, no fact
extraction. The wiki/Postgres implementation (`WikiPgProvider`) and caller
migration follow in NOT-58/59.

### The seven operations

`search`, `fetch`, `neighbors`, `upsert`, `link`, `reconcile`, `provenance`.
Each implementation advertises which it supports via a `capabilities` set;
callers MUST check `capabilities` (or `hasCapability`) before an optional op. The
wiki/Postgres provider will implement six — `link` is capability-gated OFF until
there is an edge table.

### Double enforcement

Governance is enforced twice. Tool routers keep their existing capability checks
(procedure layer). The **kernel half** is that every provider op asserts its
required toolset against the `ProviderAccessContext` via `assertOpToolset`. The
fine-grained per-path decision is NOT a JS predicate — it stays SQL-side, with
the context carrying per-toolset scope DATA (path prefixes) the provider compiles
into `WHERE` clauses (the `pathScopeWhere` pattern from access.ts).

## Ratified decisions (2026-07-03 grill session)

These are LOCKED. Do not re-litigate; full rationale lives in the Linear project
"Memory Provider & Evals" (team Noteshell, NOT-57…NOT-74).

1. **Whole-note grain.** One `MemoryNode` ↔ one `WikiNode`, the **same UUID**,
   1:1. Folder rows are not memory nodes. There is **no fact extraction yet**;
   the contract reserves optional `parentId` + `span` fields and an open `kind`
   string union so a future finer grain can join without a v2 contract (fact
   extraction is a backlog spike, NOT-69).

2. **`@acme/runtime` is the seam package.** `packages/api` already depends on
   `@acme/runtime`, and the provider needs the S3/search/embed primitives that live
   there. `@acme/runtime` must NOT depend on `@acme/api`; the access-context mapper
   therefore takes a minimal **structural** input (`ResolvedAccessLike`) that
   restates only the fields it reads from access.ts, which stays the source of
   truth.

3. **Branded `ProviderAccessContext`.** Constructible ONLY via
   `toProviderContext(ctx.access)` — a module-private `unique symbol` brand makes
   a hand-rolled context a compile error. `allowedToolsets` is derived from the
   access booleans (`canRead`→read, `canCapture`→capture, `canManage`→admin) via
   the resolved role scopes. `limits` ships in the type but is **UNENFORCED**
   until the rate-limit work (NOT-70).

4. **Scope filtering is compiled SQL-side** (the `pathScopeWhere` pattern), never
   a JS predicate in the read path. Scopes are filter data the provider compiles
   into queries; the context carries the same scope-data shape access.ts
   produces (path prefixes; `null` = unrestricted admin, `[]` = no access).

5. **SourceConnector seam is pull-based, and shipped.** Provider logic runs out
   of process behind the versioned contracts in `packages/connector-sdk`.
   Community Edition implements `SourceConnection` + `CrawlRun`
   (`packages/db/src/schema.ts`) and the shared runtime in
   `apps/nextjs/src/server/crawl/`: connector registration, QStash scheduling,
   retries, backoff, permission enforcement, and ingestion. Provider
   authentication, pagination, and API behavior stay in each connector.
   `Source.externalId` gives the stable external identity, so a re-sync
   supersedes rather than duplicates.
   Each connection carries its own `intervalSeconds` and a watermark; the
   scheduler picks up connections whose `nextRunAt` is due. That is
   **connection-scoped, not node-scoped** — it says nothing about whether a
   memory node has gone stale. A TTL sweep that re-verifies nodes past
   `lastVerifiedAt` is a separate, still-unbuilt thing (NOT-65). Do not conflate
   the two: nothing today measures node freshness.

6. **Evals run on PGlite fixtures.** A hand-curated fixture with FROZEN committed
   embeddings, run in-process on PGlite, scoring recall@5 + MRR against a
   committed `baseline.json`. CI is report-first then blocking; never on
   pre-commit (NOT-62/63).

## What is deliberately NOT here

No second provider (graph memory / PixelRAG) until an eval or customer forces it.
No `BlobStore` interface, no per-node sensitivity labels, no edge/`link` table,
and no temporal reconcile fields. Restricted-source compilation and durable
governance remain explicit next-phase work rather than parallel memory models.
