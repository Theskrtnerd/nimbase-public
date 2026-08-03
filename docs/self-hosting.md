# Self-hosting Nimbase

Nimbase Community Edition contains the complete capture, compile, search,
deployment, API, MCP, and CLI core. Community installations do not require
Stripe and do not enforce Nimbase Cloud plan limits.

This guide runs the application on the host with Postgres and an S3-compatible
object store in containers. It is an initial community deployment path, not a
hardened production topology.

## Requirements

- Node.js 22 and pnpm 10
- Docker with Compose
- A Clerk application for authentication
- An OpenAI-compatible AI endpoint with chat and 1536-dimensional embedding
  models, or a Vercel AI Gateway key

Clerk remains the authentication adapter for the first community release.
External connectors, QStash, Stripe, Langfuse, Resend, and document parsing are
optional.

## 1. Start infrastructure

```sh
docker compose up -d
```

This starts Postgres with pgvector and MinIO. The credentials in
`compose.yaml` are local-development defaults and must not be used in a public
deployment.

Enable the vector type before applying the schema:

```sh
docker compose exec -T postgres psql -U nimbase -d nimbase \
  -c 'CREATE EXTENSION IF NOT EXISTS vector'
```

## 2. Configure the runtime

Set these variables in the environment used to run Nimbase:

```sh
NIMBASE_EDITION=community
NIMBASE_DATABASE_DRIVER=postgres
POSTGRES_URL=postgresql://nimbase:nimbase-local@localhost:5432/nimbase

NIMBASE_S3_BUCKET=nimbase
NIMBASE_S3_REGION=us-east-1
NIMBASE_S3_ENDPOINT=http://localhost:9000
NIMBASE_S3_FORCE_PATH_STYLE=true
NIMBASE_AWS_ACCESS_KEY_ID=nimbase
NIMBASE_AWS_SECRET_ACCESS_KEY=nimbase-local

NIMBASE_WEB_URL=http://localhost:3100
DESKTOP_AUTH_SECRET=replace-with-at-least-32-random-characters
AGENT_CONNECTION_SECRET=replace-with-at-least-32-random-characters
CLERK_SECRET_KEY=replace-with-a-clerk-secret-key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=replace-with-a-clerk-publishable-key
NEXT_PUBLIC_NIMBASE_SOURCE_URL=https://your.example/nimbase-source
```

Set `NEXT_PUBLIC_NIMBASE_SOURCE_URL` to the corresponding source for the exact
version you deploy. Nimbase exposes it in the application and in the HTTP
`Link` header for network users.

For an OpenAI-compatible endpoint, add a complete AI override:

```sh
NIMBASE_AI_PROVIDER=openai-compatible
NIMBASE_AI_BASE_URL=http://localhost:11434/v1
NIMBASE_AI_API_KEY=replace-if-your-endpoint-requires-a-key
NIMBASE_AI_CHAT_MODEL=your-chat-model
NIMBASE_AI_NORMALIZE_MODEL=your-chat-model
NIMBASE_AI_EMBED_MODEL=your-1536-dimension-embedding-model
```

Model identifiers are passed directly to the configured endpoint. The
embedding model must emit 1536 dimensions because the current database schema
fixes that width.

To use Vercel AI Gateway instead, omit the five `NIMBASE_AI_*` provider/model
variables and set `AI_GATEWAY_API_KEY`. The default model registry will be
used.

## 3. Install and initialize

```sh
pnpm install
POSTGRES_URL=postgresql://nimbase:nimbase-local@localhost:5432/nimbase \
  pnpm --filter @acme/db exec drizzle-kit push
```

Then install the vector and full-text indexes now that their tables exist:

```sh
docker compose exec -T postgres psql -U nimbase -d nimbase \
  < packages/db/sql/0001_enable_pgvector.sql
docker compose exec -T postgres psql -U nimbase -d nimbase \
  < packages/db/sql/0002_hybrid_search.sql
```

Configure the Clerk application for `http://localhost:3100`, then start the
application with the environment above:

```sh
pnpm dev:next
```

The CLI built from this repository can target this installation:

```sh
NIMBASE_API_URL=http://localhost:3100 nimbase auth login
```

## Runtime behavior

- `NIMBASE_EDITION=community` returns unlimited product entitlements and never
  requires a Stripe subscription row.
- With no `QSTASH_TOKEN`, jobs execute inline. Use QStash for durable async
  production execution.
- With no registered connector, standing sync is empty while one-off capture
  and the rest of Nimbase continue to run. Connector credentials are sealed in
  the database with `AGENT_CONNECTION_SECRET`.
- With no optional observability, email, renderer, or parser credentials, those
  capabilities stay disabled or degrade as documented in the configuration
  schema.

## Production checklist

- Replace every local credential and terminate TLS at a trusted proxy.
- Use managed or backed-up Postgres and S3-compatible storage.
- Run database migrations before each application rollout.
- Configure QStash or another durable execution strategy for background work.
- Restrict admin access and leave `GODS` unset unless explicitly required.
- Back up both Postgres and object storage; Postgres alone is not the canonical
  memory store.
- Publish the corresponding source for deployed modifications, as required by
  AGPL-3.0.

The next community-runtime priorities are a non-Clerk authentication adapter,
versioned production container images, and automated backup/restore tooling.
