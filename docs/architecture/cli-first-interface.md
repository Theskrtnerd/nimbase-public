# CLI-first interface

Nimbase Cloud and Community Edition use the CLI as their primary product
interface. The first-party product UI is disabled until the core capture,
compile, and share systems are mature enough to support another interface well.

## Active browser surfaces

`apps/nextjs` remains the server application. It continues to own:

- CLI authentication callbacks and provider consent callbacks;
- REST and tRPC transports;
- workers and signed callbacks;
- MCP transports;
- deployment surfaces created through the CLI, including widgets, artifacts,
  and public shares.

The service root, `/dashboard/*`, `/onboarding/*`, first-party login/sign-up,
and Cloud operator pages return a plain-text `410 Gone`. Clerk hosts the
identity screen required by `nimbase auth login`, and the authenticated
callback returns directly to the CLI without rendering a Nimbase page. The
archived source stays in Git so a future UI can reuse proven domain behavior
without making inactive routes a supported interface today.

## Product workflow rule

New user-facing system capabilities must ship through a complete CLI command,
including machine-readable output, error handling, and tests. Browser use is
limited to hosted identity/provider consent and deployment outputs such as a
public share; Nimbase does not provide a browser control plane.

## Restoring a web interface

A future web interface should be treated as a new adapter over the same server
contracts, not as the owner of business behavior. Before restoring any archived
route, verify that its equivalent CLI workflow is complete, its permissions use
the shared access resolver, and its end-to-end tests pass against the current
contracts.
