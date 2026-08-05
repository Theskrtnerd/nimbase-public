import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
await jiti.import("./src/env");

const sourceUrl =
  process.env.NEXT_PUBLIC_NIMBASE_SOURCE_URL ??
  "https://github.com/Theskrtnerd/nimbase-public";

/** @type {import("next").NextConfig} */
const config = {
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@acme/api",
    "@acme/db",
    "@acme/mdx",
    "@acme/ui",
    "@acme/validators",
  ],

  // Pi discovers local provider credentials with expression-based dynamic
  // imports of node:fs/node:os/node:path. Turbopack cannot statically resolve
  // those expressions and replaces them with a throwing stub, so keep this
  // Node-only package external to the server bundle.
  serverExternalPackages: ["@earendil-works/pi-ai"],

  /** We already do linting and typechecking as separate tasks in CI */
  typescript: { ignoreBuildErrors: true },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Link", value: `<${sourceUrl}>; rel="source"` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default config;
