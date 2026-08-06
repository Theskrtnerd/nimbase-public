# CLI-first interface

Nimbase Cloud and Community Edition use the CLI as their primary product
interface. The former dashboard and web onboarding are archived until the core
capture, compile, and share systems are mature enough to support another
interface well.

## Active browser surfaces

`apps/nextjs` remains the server application. It continues to own:

- CLI and provider authentication or consent pages;
- REST and tRPC transports;
- workers and signed callbacks;
- MCP transports;
- widgets, artifacts, and public shares; and
- private Cloud operator routes supplied by the hosted overlay.

The service root is a CLI handoff page. `/dashboard/*` and `/onboarding/*`
temporarily redirect to it. The archived source stays in Git so a future UI can
reuse proven domain behavior without making the inactive routes a supported
interface today.

## Product workflow rule

New user-facing system capabilities must ship through a complete CLI command
first, including machine-readable output, error handling, and tests. Add a
browser workflow only when the task inherently requires a browser, such as an
identity-provider login, OAuth consent, or rendering a public share.

## Restoring a web interface

A future web interface should be treated as a new adapter over the same server
contracts, not as the owner of business behavior. Before restoring any archived
route, verify that its equivalent CLI workflow is complete, its permissions use
the shared access resolver, and its end-to-end tests pass against the current
contracts.
