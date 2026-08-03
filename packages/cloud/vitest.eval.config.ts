import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate config for the retrieval eval so it stays OUT of the default `pnpm
// test` glob (which is fast + mock-DB). This config runs only *.eval.ts, single-
// forked (one shared PGlite instance), and does NOT let any test mock
// @acme/db/client — the eval needs the REAL (PGlite) handle.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/memory/evals/**/*.eval.ts"],
    // The eval seeds a whole corpus and runs the full query set; give it room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    alias: {
      // Same server-only stub the default config uses (the wiki VFS imports it).
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
});
