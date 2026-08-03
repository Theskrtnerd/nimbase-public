import { z } from "zod/v4";

const aiSchema = z.object({
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  // A complete environment override lets a fresh community installation use
  // any OpenAI-compatible server without first seeding the ai_config table.
  NIMBASE_AI_PROVIDER: z.literal("openai-compatible").optional(),
  NIMBASE_AI_BASE_URL: z.string().url().optional(),
  NIMBASE_AI_CHAT_MODEL: z.string().min(1).optional(),
  NIMBASE_AI_NORMALIZE_MODEL: z.string().min(1).optional(),
  NIMBASE_AI_EMBED_MODEL: z.string().min(1).optional(),
  // Optional: API key for a self-hosted OpenAI-compatible endpoint, used only
  // when the global ai_config providerKind is "openai-compatible".
  NIMBASE_AI_API_KEY: z.string().min(1).optional(),
});

const schema = aiSchema.extend({
  NIMBASE_S3_BUCKET: z.string().min(1),
  NIMBASE_S3_REGION: z.string().min(1),
  NIMBASE_AWS_ACCESS_KEY_ID: z.string().min(1),
  NIMBASE_AWS_SECRET_ACCESS_KEY: z.string().min(1),
  NIMBASE_S3_ENDPOINT: z.string().url().optional(),
  NIMBASE_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  // Langfuse LLM observability. All optional: tracing stays dark unless both
  // keys are set (see ai/telemetry.ts). LANGFUSE_BASE_URL overrides the cloud
  // host so a self-hosted Langfuse can be pointed at instead.
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),
  // Resend transactional email. Optional: sending stays dark unless
  // RESEND_API_KEY is set (see email.ts). RESEND_FROM is the default sender
  // (e.g. "Nimbase <noreply@nimbase.ai>") and must be a Resend-verified domain.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),
  // Context.dev Parse Bytes (document/code/image → markdown; see parse.ts).
  // Optional: unset means document extraction stays dark and those captures
  // fall back to the metadata-only raw.md rather than failing.
  CONTEXT_DEV_API_KEY: z.string().min(1).optional(),
});

// Lazily validated so importing a single helper (e.g. patches) in a context
// that lacks all vars does not throw. Call cloudEnv() where the vars are needed.
let cached: z.infer<typeof schema> | null = null;
let cachedAi: z.infer<typeof aiSchema> | null = null;

export function aiEnv(): z.infer<typeof aiSchema> {
  cachedAi ??= aiSchema.parse(process.env);
  return cachedAi;
}

export function cloudEnv(): z.infer<typeof schema> {
  cached ??= schema.parse(process.env);
  return cached;
}
