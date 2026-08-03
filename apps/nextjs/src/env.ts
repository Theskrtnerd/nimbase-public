import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-nextjs/presets-zod";
import { z } from "zod/v4";

export const env = createEnv({
  extends: [vercel()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    NIMBASE_EDITION: z.enum(["cloud", "community"]).default("cloud"),
    CLERK_SECRET_KEY: z.string().min(1),
    POSTGRES_URL: z.url(),
    DESKTOP_AUTH_SECRET: z.string().min(32),
    NIMBASE_WEB_URL: z.url().default("http://localhost:3100"),
    // Artifact render service (apps/artifact-renderer) turning a stored artifact
    // into a PNG/PDF. Both optional and checked together: with either unset,
    // png/pdf chat attachments degrade to posting the share link.
    ARTIFACT_RENDERER_URL: z.url().optional(),
    ARTIFACT_RENDERER_TOKEN: z.string().min(16).optional(),
    // Stripe billing (server only; hosted Checkout + Customer Portal + webhooks).
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_PRICE_PRO: z.string().min(1).optional(),
    STRIPE_PORTAL_RETURN_URL: z.url().optional(),
    // Optional API key for a self-hosted OpenAI-compatible AI endpoint (used
    // only when the global ai_config providerKind is "openai-compatible").
    NIMBASE_AI_API_KEY: z.string().min(1).optional(),
    // Comma-separated email addresses granted platform god-mode (edit the
    // global ai_config, plan overrides, support console, crawl scheduling).
    GODS: z.string().optional(),
    // Docs-site build runner. Unset → publishing is unavailable and says so;
    // the rest of the docs-site surface (create/list/remove) still works.
    // Host published docs sites are served at. Defaults to docs.<appHost>.
    NIMBASE_DOCS_HOST: z.string().min(1).optional(),
    DOCS_BUILDER_REPO: z.string().min(1).optional(),
    DOCS_BUILDER_TOKEN: z.string().min(1).optional(),
    // HMAC secret the runner signs its completion callback with.
    DOCS_BUILDER_CALLBACK_SECRET: z.string().min(16).optional(),
    QSTASH_TOKEN: z.string().min(1).optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
    // Distributed Nimbase Slack app credentials (agent deployment). Optional so
    // the app boots without Slack configured.
    SLACK_CLIENT_ID: z.string().min(1).optional(),
    SLACK_CLIENT_SECRET: z.string().min(1).optional(),
    SLACK_SIGNING_SECRET: z.string().min(1).optional(),
    // AES-256-GCM key sealing agent + source-connection secrets (bot/OAuth
    // tokens).
    AGENT_CONNECTION_SECRET: z.string().min(16).optional(),
    // Langfuse LLM observability. Tracing stays dark unless both keys are set
    // (see instrumentation.ts); LANGFUSE_BASE_URL overrides the cloud host.
    LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
    LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
    LANGFUSE_BASE_URL: z.url().optional(),
  },

  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default("/login"),
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default("/sign-up"),
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: z
      .string()
      .default("/dashboard"),
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: z
      .string()
      .default("/dashboard"),
    // PostHog product analytics. Stays dark unless the key is set (see
    // posthog-provider.tsx). HOST is the PostHog ingestion host used only to
    // configure the same-origin `/ingest` reverse proxy (next.config.ts).
    NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
    NEXT_PUBLIC_NIMBASE_SOURCE_URL: z
      .url()
      .default("https://github.com/Theskrtnerd/nimbase-public"),
    // Apex app host used to detect org subdomains (<org>.<host>) for the
    // group-MCP friendly-URL rewrite in proxy.ts. Defaults to "nimbase.ai".
    NEXT_PUBLIC_APP_HOST: z.string().optional(),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_NIMBASE_SOURCE_URL: process.env.NEXT_PUBLIC_NIMBASE_SOURCE_URL,
    NEXT_PUBLIC_APP_HOST: process.env.NEXT_PUBLIC_APP_HOST,
  },
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});
