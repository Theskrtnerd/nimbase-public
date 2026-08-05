// Stub for "server-only" in vitest context.
// The real package throws when imported outside Next.js RSC; aliasing it here
// lets unit tests exercise server-side logic (the wiki VFS/gardener) while the
// Next.js bundler still enforces the guard during production builds.
export {};
