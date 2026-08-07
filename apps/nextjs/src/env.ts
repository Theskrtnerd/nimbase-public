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
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_ACCOUNT_PORTAL_URL: z.url().default("https://accounts.nimbase.ai"),
    POSTGRES_URL: z.url(),
    DESKTOP_AUTH_SECRET: z.string().min(32),
    NIMBASE_WEB_URL: z.url().default("http://localhost:3100"),
    // Optional API key for a self-hosted OpenAI-compatible AI endpoint (used
    // only when the global ai_config providerKind is "openai-compatible").
    NIMBASE_AI_API_KEY: z.string().min(1).optional(),
    // Operational safety limits, independent of Cloud plans or billing. A zero
    // daily budget disables the spend gate for installations using free local
    // models; request rate limiting remains enabled.
    NIMBASE_AI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    NIMBASE_AI_DAILY_BUDGET_CENTS: z.coerce.number().int().min(0).default(2500),
    NIMBASE_ALLOW_PRIVATE_CONNECTORS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    QSTASH_TOKEN: z.string().min(1).optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
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
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: z.string().default("/"),
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: z.string().default("/"),
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
    NEXT_PUBLIC_NIMBASE_SOURCE_URL: process.env.NEXT_PUBLIC_NIMBASE_SOURCE_URL,
    NEXT_PUBLIC_APP_HOST: process.env.NEXT_PUBLIC_APP_HOST,
  },
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});
