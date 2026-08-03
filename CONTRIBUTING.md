# Contributing to Nimbase

Thank you for helping build durable memory infrastructure for AI-native
companies.

## Before starting

- Open an issue before substantial or behavior-changing work.
- Keep changes focused and preserve the core invariants in `AGENTS.md`.
- Do not include customer data, credentials, private logs, or generated secrets.
- Discuss new dependencies and wire-contract changes before implementation.

## Development

Nimbase requires Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm format
git diff --check
```

For a local community runtime, follow [the self-hosting guide](docs/self-hosting.md).
Run the narrowest relevant checks while developing, then all affected package
checks before opening a pull request.

## Pull requests

- Explain the user-visible outcome and the verification performed.
- Add tests for new behavior and regressions.
- Keep authorization in the shared access modules and fail closed.
- Never hardcode AI model IDs outside the canonical model configuration.
- Define queue payloads once and validate them at workers.
- Use direct `@acme/*` subpath imports.

## Contributor license

Before a human-authored contribution can be accepted, its author must read and
affirm the [Nimbase Contributor License Agreement](CLA.md) in the pull request
template. The CLA lets contributors retain their copyright while granting
Nimbase the rights required to maintain both Community Edition and commercial
Nimbase distributions.

Accepted contributions are published under the license that applies to the
files being changed:

- `Apache-2.0` for `apps/cli/`, `packages/connector-sdk/`, and
  `packages/validators/`.
- `AGPL-3.0-only` for every other software directory unless a closer license
  file states otherwise.

By submitting a contribution, you also certify that you have the right to do
so. Contributions owned by an employer or another legal entity may require a
separate corporate agreement. See `CLA.md` and `LICENSING.md` for the complete
terms and directory-level license boundary.
