// Stub for "@acme/db/client" in vitest context.
// The real client throws when POSTGRES_URL is absent.
// Unit tests that only exercise pure functions (e.g. hashApiToken) don't need
// a real DB connection; this stub satisfies the import without side effects.
export const db = {} as never;
