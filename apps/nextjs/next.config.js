import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
await jiti.import("./src/env");

// PostHog ingestion host + its static-asset sibling, used only to configure the
// same-origin `/ingest` reverse proxy below (keeps analytics first-party and out
// of ad-blocker reach). `us.i.posthog.com` -> `us-assets.i.posthog.com`.
const posthogHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const posthogAssetsHost = posthogHost.replace(
  /^(https:\/\/)([^.]+)\./,
  "$1$2-assets.",
);

// Published docs sites are served under one ordinary subdomain, by path:
//   docs.nimbase.ai/<workspace-slug>/<site-slug>/...
//
// One CNAME, covered by an existing single-label wildcard cert — no nameserver
// delegation and no per-site domain registration. The cost is that Nimbus is
// base-unaware (`BASE_URL` appears nowhere in its runtime), so the builder
// repo's starter carries a small `withBase` patch at the few places nav data
// enters a page. Verified against a real build; see the runner README.
const docsHost =
  process.env.NIMBASE_DOCS_HOST ??
  `docs.${process.env.NEXT_PUBLIC_APP_HOST ?? "nimbase.ai"}`;
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

  // Required for the PostHog reverse proxy: the API needs trailing-slash-exact
  // paths preserved (e.g. /ingest/flags), so don't auto-redirect them.
  skipTrailingSlashRedirect: true,

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

  async rewrites() {
    return {
      // Published docs sites live on their own host and are served out of S3
      // by a route handler. This is a `beforeFiles` host rewrite rather than a
      // middleware rewrite on purpose: the middleware matcher excludes static
      // asset extensions (.css/.js/.woff2/…), so a middleware-based rewrite
      // would serve a site's HTML and 404 every asset it references.
      beforeFiles: [
        {
          source: "/:path*",
          has: [{ type: "host", value: docsHost }],
          destination: "/api/docs-site/:path*",
        },
      ],
      afterFiles: [
        {
          source: "/ingest/static/:path*",
          destination: `${posthogAssetsHost}/static/:path*`,
        },
        { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
      ],
    };
  },
};

export default config;
