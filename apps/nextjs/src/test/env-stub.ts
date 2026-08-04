// Stub for "~/env" in vitest context.
// The real module validates required runtime variables at import time via
// @t3-oss/env-nextjs, which throws when they're
// unset. Unit tests that only exercise pure functions (e.g.
// groupMcpRewritePath) don't need real env vars; this stub satisfies the
// import without that validation.
export const env = {} as Record<string, string | undefined>;
