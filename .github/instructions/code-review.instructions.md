---
applyTo: "**"
---

# Code Review Instructions for Copilot

## Project Context

Nimbase is multi-tenant memory infrastructure built as a Turborepo + pnpm
monorepo. The primary surface is the CLI. The Next.js app owns REST, tRPC,
workers, MCP, auth, and shares; shared domain code lives in `packages/`.

## Code Style Rules

- **No `useEffect` without justification**: Prefer derived state, event handlers, and React primitives (`useMemo`, `useSyncExternalStore`). If `useEffect` is used, require a comment explaining why.
- **No `any` type**: Use `unknown`, generics, or proper types instead.
- **Direct imports**: Use `@acme/*` subpath imports instead of package barrels.

## Review Focus Areas

### High Priority

- Security: command injection, path traversal, credential leaks, and workspace
  tenancy violations. Workspace and folder access must use `resolveAccess` or
  `requireAccess` and fail closed.
- Memory leaks: uncleaned event listeners, unresolved promises
- Type safety: no `any`, proper discriminated unions

### Medium Priority

- Error handling: failures must be handled at the boundary that can recover or
  add useful context; do not silently swallow errors.
- State consistency: no UI state transitions without matching cleanup paths

### Low Priority (Don't Flag)

- Formatting/style that prettier/eslint handles automatically
- Minor naming preferences
- TODO comments (these are intentional markers for future work)

## Don't Suggest

- Replacing the runtime MDX renderer with a build-time solution
- Adding new frameworks or state libraries; the stack is intentionally minimal
