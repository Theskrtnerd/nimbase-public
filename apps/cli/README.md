# Nimbase CLI

The primary control plane for [Nimbase](https://nimbase.ai) — memory infrastructure
for companies. Organized around the three stages of the memory lifecycle:

| Pillar   | What it covers                                                         |
| -------- | ---------------------------------------------------------------------- |
| `sync`   | Out-of-process connectors that continuously feed memory                |
| `memory` | Capturing into, searching, and reading company memory                  |
| `deploy` | Serving memory — agents, MCP endpoints, docs sites, widgets, artifacts |

`auth`, `workspace`, and `doctor` sit alongside them as plumbing.

## Install

```sh
npm install --global nimbase
nimbase --help
```

To work from a source checkout:

```sh
pnpm install
pnpm --filter ./apps/cli build
pnpm --dir apps/cli link --global
```

## Authenticate

```sh
nimbase auth login          # opens your browser, stores a 30-day session token
nimbase auth whoami
nimbase auth logout
```

## Usage

### Workspaces

```sh
nimbase workspace create https://acme.example

# Without a website, both fields are required:
nimbase workspace create \
  --title "Acme" \
  --description "Infrastructure for autonomous warehouses"

nimbase workspace list             # the default is marked with *
nimbase workspace use acme         # select by short workspace slug
nimbase workspace status           # plan, memory, capture, and sync health
nimbase workspace plan pro         # owner: Stripe Checkout; staff: direct override
nimbase workspace model            # effective agent model + available choices
nimbase workspace model google/gemini-2.5-flash
nimbase workspace model --inherit  # return to the global default
```

### Sync — standing knowledge channels

```sh
nimbase sync providers
export ACME_CONNECTOR_SECRET="replace-me"
nimbase sync add https://connector.example \
  --secret-env ACME_CONNECTOR_SECRET \
  --config '{"project":"engineering"}' \
  --interval 86400
nimbase sync scopes <connectionId>
nimbase sync configure <connectionId> --scope project-a project-b
nimbase sync list
nimbase sync get <connectionId>          # config + recent sync runs
nimbase sync run                         # enqueue every active connection
nimbase sync run --wait                  # wait for all of them
nimbase sync run <connectionId> --wait   # wait for one exact crawl run
nimbase sync run acme/issues --wait       # run one unambiguous connector id
```

Connector authors implement the versioned protocol in
[Building a connector](../../docs/connectors.md). Community Edition handles
scheduling, retries, idempotency, permissions, and ingestion.

### Memory — capture, search, read

```sh
nimbase memory search "vector search" --limit 5
nimbase memory get <nodeId>              # print a note's markdown body
nimbase memory captures list             # all captures + compile status
nimbase memory captures get <captureId>  # inspect one captured item

echo "a quick thought" | nimbase memory capture --wait
nimbase memory capture "from the cli" --title "Idea" --kind highlight
nimbase memory capture --file ./notes.md
nimbase memory capture --file ./notes.md --folder <folderUuid>
```

### Deploy — the governed exits

Every deployment type uses the same creation shape:

```sh
nimbase deploy <agent|artifact|docs|mcp> create <prompt>
```

The prompt is the primary name or intent for the deployment. Type-specific flags
configure its interface, tools, publication, or sharing behavior. Every create
command accepts `--slug`; otherwise Nimbase derives a stable slug from the prompt.

```sh
# An agent deployed to Slack
nimbase deploy agent create "Support Assistant" --interface slack

# The same agent model, delivered as an embeddable website interface
nimbase deploy agent create "Support Widget" \
  --interface widget
nimbase deploy agent list
nimbase deploy agent get support-assistant
nimbase deploy agent remove support-assistant

# An OAuth-only MCP endpoint
nimbase deploy mcp create "Customer Support" \
  --tool search --tool get_note
nimbase deploy mcp list
nimbase deploy mcp get customer-support
nimbase deploy mcp remove customer-support

# A documentation site written from memory
nimbase deploy docs create "Acme Docs" --public
nimbase deploy docs create "Engineering Docs" --folder engineering
nimbase deploy docs publish acme-docs --wait
nimbase deploy docs list
nimbase deploy docs get acme-docs
nimbase deploy docs remove acme-docs

# A generated artifact
nimbase deploy artifact create "a table of my open questions" --wait
nimbase deploy artifact list
nimbase deploy artifact get open-questions
nimbase deploy artifact access open-questions public # private | public
nimbase deploy artifact remove open-questions

# Every deployment type, with bare slugs and typed refs such as artifact:open-questions
nimbase deploy list
```

Artifact visibility is intentionally limited to `private` and `public`. Public
artifacts work for anyone with the link, while share responses send
`X-Robots-Tag: noindex` so search engines do not index them.

### Diagnose

```sh
nimbase doctor    # runtime, credential, config file + permissions, workspace
                  # access, provider availability, sync and capture health
```

### Global flags & environment

- `--json` — print the raw API payload on stdout (for scripting / agents).
- `--workspace <slug>` — override the default workspace for one command.
- `NIMBASE_API_URL` — base URL override (default `https://app.nimbase.ai`).
- `NIMBASE_TOKEN` — a folder-scoped API token; takes precedence over the stored
  session and puts the CLI in automation mode.

### Exit codes

`0` success · `1` runtime error · `2` usage error · `3` not found · `4` auth
error (run `nimbase auth login`).

### Errors

Errors always go to stderr, so a `--json` invocation's stdout stays a single
parseable document whether it succeeded or not. Under `--json`, failures are an
envelope with a stable `code` — branch on the code, not the prose:

```json
{
  "error": {
    "code": "not_found",
    "message": "No note with id … in this workspace."
  }
}
```

Codes: `auth_required`, `forbidden`, `not_found`, `usage`, `invalid_request`,
`limit_reached`, `conflict`, `timeout`, `server_error`, `runtime`.

### Pagination

Pagination is internal. `memory captures list`, `deploy artifact list`, and
`deploy list` retrieve every page automatically.

## Notes

- **Two credential modes.** A browser session (`auth login`) is the human path.
  `NIMBASE_TOKEN` is the automation path, but it is folder-scoped and read-oriented:
  every administrative surface — `sync add`, all of `deploy`, `workspace create`,
  `workspace model`, and `workspace plan` — requires a real session and fails
  fast with exit code `4`.
- **Connection vs capture.** A connection is a standing channel (`SourceConnection`);
  a capture is a single ingested item (`Source`). `sync get <id>` inspects the former,
  `memory captures get <id>` the latter. There is no `sync remove` — the API exposes
  no delete for connections yet.
- `sync add` registers an HTTPS connector endpoint. Pass its bearer credential
  through `--secret-env`; the secret value is read from the named environment
  variable and is never stored in CLI configuration. `--interval` accepts
  300–2592000 seconds and defaults to daily.
- `deploy agent create` supports `--interface slack` and `--interface widget`.
  Slack completes its install in the browser. Widget works on any website by
  default and prints a paste-ready embed snippet. Deployment slugs are generated
  from agent names and remain stable if a name is later edited.
- `workspace model <model-id>` changes the workspace chat-model override. Every
  deployed agent resolves that setting on its next turn; `--inherit` removes the
  override and returns to the global default.
- `workspace plan <plan>` is idempotent and owner-only for normal users.
  Free → Pro opens Stripe Checkout; an existing live subscription never opens a
  second Checkout and uses the Stripe Billing Portal when recovery or a downgrade
  is needed. Enterprise requests open the contact path. Nimbase staff use the same
  command for audited direct overrides and receive a warning when a live Stripe
  subscription could later overwrite the override. `--no-open` prints any next-step
  URL without opening it.
- `deploy mcp create` exposes OAuth only; API-key automation is intentionally
  unavailable in this release. Tools default to `search`, `get_note`, `list_sources`;
  `capture` and `create_artifact` are opt-in via `--tool`.
- Every deployment has a bare slug within its type. Type-specific commands accept
  that slug; mixed deployment output also includes an unambiguous typed reference
  such as `agent:support` or `docs:handbook`. Internal UUIDs remain available in
  JSON where applicable.
- `deploy agent create`, `deploy artifact create`, `deploy docs create`, and
  `deploy mcp create` use the whole centralized KB when `--folder` is omitted.
  Agent and artifact folders are UUIDs; MCP and docs folders are memory paths.
  `publish` rebuilds from current memory, and a failed build with `--wait` exits
  non-zero.
- **Plan limits.** Widgets and docs sites are standing-count entitlements: Free allows
  none, Pro allows 5 widgets and 3 docs sites, Enterprise is unlimited. Captures,
  artifacts, members, and storage are metered too — creation fails with the limit in
  the error message once a workspace is over.
- Captures, synchronization, artifacts, and docs builds run asynchronously; pass
  `--wait` where supported or inspect their status separately.
- Capture and agent/artifact `--folder` values are internal folder UUIDs. MCP and docs
  `--folder` values are memory paths.
- The CLI never edits notes — that surface doesn't exist in Nimbase's API.
- `workspace create <website>` is the default creation path. Context.dev
  populates the workspace title and description in the background before the
  Biographer writes `company.md`. Without a website, pass both `--title` and
  `--description`. With a website, either explicit field overrides its
  Context.dev-derived value while unspecified fields still come from Context.dev.

## License

[Apache-2.0](./LICENSE). You may use, modify, redistribute, and embed the CLI
under this permissive license. Use it with Nimbase Cloud or point it at a
[self-hosted Nimbase installation](../../docs/self-hosting.md) by setting
`NIMBASE_API_URL`.

## Releasing (maintainers)

Release tags publish from GitHub Actions with npm trusted publishing and
provenance. The tag must match the package version exactly:

```sh
git tag cli-v0.1.0
git push origin cli-v0.1.0
```

For an initial manual publish, build a pnpm tarball first so `catalog:` and
`workspace:` dependencies are resolved, then publish that tarball with npm.
