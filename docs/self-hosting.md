# Self-hosting Nimbase Community Edition

Community Edition is the self-hosted memory and agent-harness runtime. It
includes capture, compile, OKF storage, hybrid search, the Pi harness, virtual
filesystem/sandbox tools, the CLI/API/MCP surfaces, widgets, artifacts, shares,
and generic connector orchestration. It has no billing gates.

Nimbase Cloud's billing, operator console, managed docs publisher, first-party
Slack adapter, maintained provider connectors, and deployment operations are
not registered by the Community server.

This guide is a quick single-host setup. It is suitable for evaluating Nimbase
and as a base for your own deployment, but it is not a complete production
topology.

## Requirements

- Node.js 22 and pnpm 10
- Docker with Compose
- A Clerk application for authentication
- An OpenAI-compatible endpoint with chat and 1536-dimensional embedding
  models, or a Vercel AI Gateway key

Clerk is the authentication adapter in the first Community release. QStash and
Langfuse are optional. Rich document parsing is a hosted adapter; Community
keeps the original file and a metadata-only note for unsupported formats.

## Quick start

### 1. Start Postgres and object storage

```sh
docker compose up -d
docker compose exec -T postgres psql -U nimbase -d nimbase \
  -c 'CREATE EXTENSION IF NOT EXISTS vector'
```

The included Compose file starts Postgres with pgvector and MinIO and creates
the `nimbase` bucket. Its credentials are local-development defaults; do not
reuse them on a public host.

### 2. Export the runtime configuration

```sh
export NIMBASE_DATABASE_DRIVER=postgres
export POSTGRES_URL=postgresql://nimbase:nimbase-local@localhost:5432/nimbase

export NIMBASE_S3_BUCKET=nimbase
export NIMBASE_S3_REGION=us-east-1
export NIMBASE_S3_ENDPOINT=http://localhost:9000
export NIMBASE_S3_FORCE_PATH_STYLE=true
export NIMBASE_AWS_ACCESS_KEY_ID=nimbase
export NIMBASE_AWS_SECRET_ACCESS_KEY=nimbase-local

export NIMBASE_WEB_URL=http://localhost:3100
export DESKTOP_AUTH_SECRET=replace-with-at-least-32-random-characters
export AGENT_CONNECTION_SECRET=replace-with-at-least-32-random-characters
export CLERK_SECRET_KEY=replace-with-a-clerk-secret-key
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=replace-with-a-clerk-publishable-key
export NEXT_PUBLIC_NIMBASE_SOURCE_URL=https://github.com/Theskrtnerd/nimbase-public

# Operational AI safety limits (set 0 only for the daily spend gate when using
# a free local model; the request-rate gate always remains enabled).
export NIMBASE_AI_REQUESTS_PER_MINUTE=30
export NIMBASE_AI_DAILY_BUDGET_CENTS=2500
```

Set `NEXT_PUBLIC_NIMBASE_SOURCE_URL` to the source for the exact revision you
deploy. Nimbase exposes it in the application and its HTTP `Link` header for
network users.

For an OpenAI-compatible endpoint, add one complete model override:

```sh
export NIMBASE_AI_PROVIDER=openai-compatible
export NIMBASE_AI_BASE_URL=http://localhost:11434/v1
export NIMBASE_AI_API_KEY=replace-if-your-endpoint-requires-a-key
export NIMBASE_AI_CHAT_MODEL=your-chat-model
export NIMBASE_AI_NORMALIZE_MODEL=your-chat-model
export NIMBASE_AI_EMBED_MODEL=your-1536-dimension-embedding-model
```

Model identifiers are passed directly to the endpoint. The embedding model
must emit 1536 dimensions because the current database schema fixes that
width. To use Vercel AI Gateway instead, omit the six `NIMBASE_AI_*` variables
above and set `AI_GATEWAY_API_KEY`.

### 3. Install and initialize

```sh
pnpm install
pnpm db:push:community

docker compose exec -T postgres psql -U nimbase -d nimbase \
  < packages/db/sql/0001_enable_pgvector.sql
docker compose exec -T postgres psql -U nimbase -d nimbase \
  < packages/db/sql/0002_hybrid_search.sql
```

Configure the Clerk application for `http://localhost:3100`, then start the
Community server without Nimbase's private secret manager wrapper:

```sh
pnpm dev:community
```

Keep the Community server running, then install the published CLI and point it
at that installation. The browser opens only for the authentication step:

```sh
npm install --global nimbase
NIMBASE_API_URL=http://localhost:3100 nimbase auth login
NIMBASE_API_URL=http://localhost:3100 nimbase workspace create \
  --title "Acme" \
  --description "Company memory for Acme"
```

The server root shows a CLI handoff page. The former dashboard and web
onboarding routes are archived and redirect there; workspace creation,
capture, sync, memory, and deployment operations are CLI workflows.

## What Community exposes

| Included in the self-hosted server              | Not included in the self-hosted server     |
| ----------------------------------------------- | ------------------------------------------ |
| Capture, compile, OKF memory, search            | Cloud billing, checkout, and webhooks      |
| Pi harness, VFS, sandbox, agent definitions     | Platform operator/support access           |
| CLI, REST/tRPC, MCP, widgets, artifacts, shares | Nimbase's Slack OAuth/webhook adapter      |
| Generic connector SDK, sync worker, scheduler   | Maintained first-party provider connectors |
| Signed or inline background jobs                | Managed docs-site builder and publishing   |
| HTML artifact downloads                         | Managed PNG/PDF rendering                  |

The Apache-licensed CLI and validator packages intentionally retain wire
contracts used by both Community and Nimbase Cloud. Consequently, commands
such as `workspace plan`, `deploy docs`, and `deploy agent --interface slack`
may appear in the CLI but have no Community server implementation. Use the
built-in widget/MCP surfaces or add your own adapter at the server boundary.

For continuous sync, build an out-of-process provider adapter with
`@nimbase/connector-sdk`; see [Building a connector](./connectors.md). Community
owns schedules, retries, cursor persistence, ingestion, and permission fences,
while your connector owns provider credentials and API behavior.

The server also exposes an `ArtifactFileRenderer` adapter seam. Community
serves sandboxed HTML and can attach that HTML directly; a distribution may
provide its own isolated PNG/PDF renderer without placing browser-execution
code in the Community runtime.

Hosted distributions can register a `RichDocumentExtractor` during server
startup for PDF, Office, image, or other vendor-backed parsing. With no adapter
registered, Community keeps the original bytes and emits a metadata-only note
instead of sending content to a third party.

Connector endpoints must use public HTTPS by default. If an installation
deliberately runs connectors on a private network, set
`NIMBASE_ALLOW_PRIVATE_CONNECTORS=true`; this relaxes the private-address and
HTTP protections for connector requests only, so enable it only on a network
whose connector endpoints you trust.

## Background jobs

With no `QSTASH_TOKEN`, jobs execute inline. This is convenient locally but is
not durable: a process restart can lose in-flight work.

For production, configure `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and
`QSTASH_NEXT_SIGNING_KEY`. Create a recurring QStash schedule whose destination
is `${NIMBASE_WEB_URL}/api/crawl/scheduler`; the scheduler and worker routes
verify QStash signatures. Compile, extract, artifact, brain-init, and connector
jobs then publish through the same signed queue adapter.

## Production build

With the same environment exported:

```sh
pnpm build:community
pnpm start:community
```

Before exposing the service:

- Replace every local credential and terminate TLS at a trusted proxy.
- Use backed-up Postgres and S3-compatible storage.
- Apply schema changes and search indexes before each rollout.
- Configure durable background jobs and monitor failed work.
- Back up both Postgres and object storage; Postgres is a derived index, not the
  canonical memory body store.
- Restrict connector egress and run only connector code you trust.
- Set `NEXT_PUBLIC_NIMBASE_SOURCE_URL` to the corresponding deployed source and
  offer source for network modifications as required by AGPL-3.0-only.

The next Community deployment priorities are a non-Clerk authentication
adapter, versioned container images, and automated backup/restore tooling.
