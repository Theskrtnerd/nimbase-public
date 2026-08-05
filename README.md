<div align="center">

# Nimbase

**Memory infrastructure for modern companies.**

Nimbase captures what a company knows, compiles it into one durable knowledge base,
and serves it to employees, applications, and AI agents. A company-scoped identity
spine gives each employee one stable profile across connected systems.

> **Open source and self-hostable.** The complete core is licensed under
> AGPL-3.0, while the CLI, connector SDK, and shared wire contracts use
> Apache-2.0. Run it yourself, build against its client interfaces, or use
> Nimbase Cloud.

[Website](https://nimbase.ai) · [Self-hosting](./docs/self-hosting.md) · [Roadmap](https://nimbase.ai/roadmap) · [CLI docs](./apps/cli/README.md) · [Report a bug](https://github.com/Theskrtnerd/nimbase-public/issues)

[![License: AGPL core / Apache clients](https://img.shields.io/badge/license-AGPL_core_%2F_Apache_clients-blue.svg)](#license)
[![Beta](https://img.shields.io/badge/status-beta-orange.svg)](#status)

</div>

---

## Why Nimbase

The defining constraint of a company using AI is not intelligence. It's memory.

Models are commodity. What's scarce is durable, structured, source-grounded company
context — and the ability to use it from a customer-facing widget, a coding agent, or
an employee workflow without losing its provenance.

Storage-and-retrieval products search over whatever mess you dumped in. Nimbase
**compiles**: an agent with filesystem-grade access to your memory restructures raw
captures into coherent, interlinked, cited concepts — and it's stateful, so it knows what
is already there.

## The loop

```
capture/sync  →  compile  →  centralized KB  →  deploy
```

| Stage        | What it means                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sync**     | Out-of-process connectors feed memory continuously on a per-connection interval with scope selection and opaque cursors. Community Edition owns the protocol and orchestration; connector authors own provider authentication and APIs. Plus one-off capture from the CLI and MCP `capture` tool. |
| **Memory**   | The gardener agent compiles captures into structured memory. Bodies are [OKF v0.1](./docs/superpowers/specs/2026-07-18-nimbase-okf-memory-format-design.md) markdown with YAML frontmatter, versioned in S3; Postgres is a derived index. Retrieval is hybrid vector + full-text, fused by RRF.   |
| **Identity** | `UserProfile` resolves an employee across connected systems by stable provider identity first, then exact verified company email. Names are never used as identity evidence.                                                                                                                      |
| **Deploy**   | Agents, MCP endpoints, widgets, artifacts, and shares use the whole KB by default. An optional folder anchor can narrow a deployment without creating another copy of memory. Community ships the widget interface; hosted interface adapters live in Nimbase Cloud.                              |

### The exits

| Surface           | Serves                                                    |
| ----------------- | --------------------------------------------------------- |
| `deploy agent`    | Customers through a self-hosted website widget            |
| `deploy mcp`      | Any AI client your team already uses, over OAuth          |
| `deploy artifact` | Anyone — a prompt becomes a rendered, shareable interface |

### Trust model

The gardener is the sole structured-memory writer and runs backend-only. Every source
produces one canonical compile; deployments never trigger projected copies. Existing
path-scope checks remain fail-closed, while provider ACL mirroring and the long-term
governance model are deliberately the next architecture phase.

## Getting started

The CLI is the primary interface and the scriptable control plane.

```sh
npm install --global nimbase
nimbase auth login
```

```sh
# Create a workspace and register a connector
nimbase workspace create https://acme.example
export ACME_CONNECTOR_SECRET="replace-me"
nimbase sync add https://connector.example \
  --secret-env ACME_CONNECTOR_SECRET \
  --config '{"project":"engineering"}'
nimbase sync run --wait

# Watch memory compile, then read it
nimbase workspace status
nimbase workspace model google/gemini-2.5-flash
nimbase memory search "SSO decision"
nimbase memory get <nodeId>

# Serve the centralized KB, or optionally narrow a deployment with --folder
nimbase deploy agent create "Support" --interface widget
nimbase deploy mcp create "Engineering" --folder engineering
```

Every command takes `--json` for scripting and agent use, and `--workspace <slug>` to
override the default. See the [CLI reference](./apps/cli/README.md) for the full surface.

The self-hosted web app handles login and the flows the CLI cannot reasonably
provide. See [Building a connector](./docs/connectors.md) for the versioned
protocol and SDK. Some Apache-licensed CLI commands also target optional
Nimbase Cloud surfaces; the [self-hosting guide](./docs/self-hosting.md) lists
the exact Community boundary.

## Status

Nimbase is in **public beta**. Things change quickly — we use Nimbase to build Nimbase,
so the rough edges get noticed fast.

Two limits worth stating plainly:

- **Node freshness is not yet measured.** Sync intervals are connection-scoped; nothing
  today re-verifies whether an individual memory node has gone stale.
- **Compile legibility is in progress.** Memory that restructures itself needs a
  "what changed" view to feel trustworthy rather than haunted. Versions are append-only,
  so the history is there; the diff surface is not finished.

## Architecture

Turborepo + pnpm monorepo.

```
apps/
├─ cli/               nimbase CLI — the primary control plane (commander + tsup)
└─ nextjs/            REST + tRPC API, workers, MCP transport, auth, shares

packages/
├─ connector-sdk/ Apache-licensed contracts and connector handler
├─ api/           tRPC router + core business services
├─ runtime/       memory, harness/VFS, capture/compile, search, S3, queue
├─ db/            Drizzle schema, migrations, path-scope SQL helpers
├─ agents/        agent definitions — gardener, chat, biographer, artifact
├─ validators/    shared Zod wire schemas, including the CLI contract
├─ ui/            shadcn/ui component library
└─ mdx/           MDX processing
```

Deeper reading: [memory kernel architecture](./docs/architecture/memory-kernel.md) ·
[design system](./DESIGN.md) · [agent conventions](./CLAUDE.md).

### Run from source

For the complete community installation path, including local Postgres,
S3-compatible storage, AI configuration, and authentication setup, read the
[self-hosting guide](./docs/self-hosting.md).

```sh
# Requires: Node 22+, pnpm 10+
pnpm install
pnpm dev:community
```

```sh
pnpm -F nimbase build   # build the CLI
pnpm typecheck          # full TS check (the Next build ignores TS errors)
pnpm test               # test suites
pnpm lint:fix           # auto-fix lint
pnpm db:push:community  # Drizzle schema for an exported POSTGRES_URL
```

## Roadmap

- ☑ Capture: CLI and MCP `capture`
- ☑ Compile: the gardener agent over a versioned OKF memory tree
- ☑ Sync: versioned connector protocol, SDK, scheduling, retries, and ingestion
- ☑ Company identity: stable user profiles across verified source identities
- ☑ Deploy: local agents, MCP endpoints, widgets, shares, and artifacts
- ☑ CLI as the primary control plane
- ☐ Provider ACL mirroring and the long-term governance model
- ☐ Memory freshness and staleness signals
- ☐ Compile diffs and a "what changed" view
- ☐ Access matrix and agent-access audit surfaces in the CLI
- ☐ Team workspaces (members, roles)

See [the public roadmap](https://nimbase.ai/roadmap) for the live version.

## Open source

Nimbase uses a deliberately split open-source model:

- The server, memory engine, capture/compile system, web application, workers,
  and other core packages are licensed under
  [AGPL-3.0-only](./LICENSE). If users interact with a modified version over a
  network, the AGPL requires offering them the corresponding source.
- The distributed [Nimbase CLI](./apps/cli), connector SDK
  (`packages/connector-sdk`), and shared wire-contract package
  (`packages/validators`) are licensed under
  [Apache-2.0](./apps/cli/LICENSE), allowing applications, scripts, and tools to
  integrate with Nimbase without adopting the server's copyleft license.

See [LICENSING.md](./LICENSING.md) for the authoritative directory-level
boundary. A license on one component does not change the license of another
component merely because they communicate over Nimbase's API.

Nimbase Cloud is the managed distribution: hosting, upgrades, operational
reliability, maintained first-party connectors and interface adapters, billing,
support tooling, and managed publishing. Community Edition contains the
complete memory and harness core plus protocols for self-hosted or third-party
connectors; it does not enforce cloud billing limits. See
[self-hosting](./docs/self-hosting.md), [contributing](./CONTRIBUTING.md), and
[the trademark policy](./TRADEMARKS.md).

### Reporting bugs

Open an [issue](https://github.com/Theskrtnerd/nimbase-public/issues) with reproduction steps.

### Contributing

PRs are welcome but please open an issue first for anything non-trivial. The pre-commit
hook runs format, lint, typecheck, and tests — all must pass. Read
[CONTRIBUTING.md](./CONTRIBUTING.md); agent-assisted contributors should also
read `CLAUDE.md` and `AGENTS.md`.

## Tech stack

Next.js · React 19 · TypeScript · Tailwind v4 · shadcn/ui · tRPC · Drizzle · Postgres
(Neon) · pgvector · Clerk · Vercel AI SDK · Pi agent harness · QStash · S3 · Commander · Turborepo · pnpm

## Acknowledgments

The monorepo scaffolding originally forked from [`create-t3-turbo`](https://github.com/t3-oss/create-t3-turbo) — thanks to Julius Marminge and the T3 community. See [AUTHORS.md](./AUTHORS.md) and [NOTICE](./NOTICE) for contributor and attribution information.

## License

The Nimbase core is [AGPL-3.0-only](./LICENSE); the CLI, connector SDK, and
shared wire contracts are [Apache-2.0](./apps/cli/LICENSE). See
[LICENSING.md](./LICENSING.md) for the exact boundary. The Nimbase name and
logos remain subject to the [trademark policy](./TRADEMARKS.md).
