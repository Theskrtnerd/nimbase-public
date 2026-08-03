import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Single source of truth for the version the CLI reports: baked in at build
// time from package.json, so `nimbase --version` cannot drift from the
// published package the way a hand-written string did.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  define: { __CLI_VERSION__: JSON.stringify(version) },
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  // Inline the workspace validators so the published bin is self-contained
  // (commander + zod stay external — they're real published dependencies).
  noExternal: ["@acme/validators"],
  banner: { js: "#!/usr/bin/env node" },
});
