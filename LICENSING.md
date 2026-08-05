# Nimbase licensing

Nimbase uses two open-source licenses. The license is determined by the path of
the source file, with the closest license file taking precedence.

## Apache-2.0 client components

The following directories are licensed under the Apache License, Version 2.0:

- `apps/cli/` — the distributed `nimbase` command-line client.
- `packages/connector-sdk/` — versioned contracts and helpers for independent
  connector implementations.
- `packages/validators/` — shared API and CLI wire schemas bundled into or used
  by client software.

The complete Apache-2.0 text is in `apps/cli/LICENSE`. These components may be
used, modified, distributed, and embedded independently under Apache-2.0.

## AGPL-3.0-only core

All other software in this repository is licensed under the GNU Affero General
Public License, Version 3 only, unless a closer license file expressly states
otherwise. This includes:

- `apps/nextjs/`.
- `packages/agents/`, `packages/api/`, `packages/runtime/`, `packages/db/`,
  `packages/mdx/`, and `packages/ui/`.
- The repository's build and development tooling.

The complete AGPL-3.0-only text is in the root `LICENSE` file.

## Boundaries and attribution

Communicating with the AGPL-licensed server through its REST, MCP, or other
network interfaces does not by itself change the license of an independent
client. Combining or modifying source code can have different consequences;
review the applicable license text for your use case.

Third-party notices and acknowledgments are recorded in `NOTICE`. The software
licenses do not grant rights to the Nimbase trademarks; see `TRADEMARKS.md`.
