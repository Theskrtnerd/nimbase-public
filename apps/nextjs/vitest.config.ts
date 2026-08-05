import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      // "server-only" throws when imported outside Next.js RSC context.
      // The Next.js bundler enforces the guard at build time; aliasing here
      // only affects the vitest runner and does not weaken the production guard.
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url)
        .pathname,
      // "@acme/db/client" throws on import when POSTGRES_URL is absent.
      // Unit tests for pure functions don't need a real DB connection.
      "@acme/db/client": new URL(
        "./src/test/db-client-stub.ts",
        import.meta.url,
      ).pathname,
      // "~/env" validates required env vars at import time via
      // @t3-oss/env-nextjs, which throws when they're unset. Unit tests for
      // pure functions (e.g. groupMcpRewritePath) don't need real env vars.
      "~/env": new URL("./src/test/env-stub.ts", import.meta.url).pathname,
      "~": new URL("./src", import.meta.url).pathname,
    },
  },
});
