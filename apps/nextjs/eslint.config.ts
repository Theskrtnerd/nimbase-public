import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@acme/eslint-config/base";
import { nextjsConfig } from "@acme/eslint-config/nextjs";
import { reactConfig } from "@acme/eslint-config/react";

export default defineConfig(
  {
    // public/ ships as-is to browsers (e.g. the widget embed script) — plain
    // JS outside the TS project, so the type-aware rules can't apply.
    ignores: [".next/**", "public/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
