# Nimbase contributor guide

Nimbase is memory infrastructure for AI-native companies. Its core loop is
Capture → Compile → Share. This is a pnpm/Turborepo monorepo.

## Product priorities

1. Backend and runtime systems: domain packages, API contracts, permissions,
   queues, capture/compile, reliability, observability, and tests.
2. `apps/cli/`: the primary user interface and scriptable control plane.
3. `apps/nextjs/`: authentication, REST/API, workers, MCP, and shares.
4. `packages/connector-sdk/`: provider-neutral wire contracts for independent
   out-of-process connectors.

## Core invariants

- All workspace and folder access goes through the shared access-resolution
  helpers and fails closed.
- Stored memory is OKF markdown. The OKF codec and versioned memory writer are
  the canonical write path; Postgres is a derived index.
- AI model selection goes through the shared model resolver and cost registry.
- Queue payloads are defined once with Zod and parsed by their workers.
- Provider APIs and credentials stay outside Community Edition. Sync adapters
  implement the connector SDK; the core owns scheduling and ingestion.
- API tokens remain folder-scoped and caller-provided scopes are never widened.
- Never commit credentials, customer data, private logs, or environment files.

## Engineering rules

- Avoid `any`; use real types, generics, or `unknown` at explicit boundaries.
- Use direct `@acme/*` subpath imports.
- Prefer small, focused changes over unrelated refactors.
- Add tests for behavior changes and authorization boundaries.
- Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
  `git diff --check` before submitting a pull request.

See `CONTRIBUTING.md`, `SECURITY.md`, and `docs/architecture/` for more.
