// One-off additive migration for the centralized AI model config:
//   pnpm -F @acme/db migrate:ai-config
// Creates ai_config + workspace_ai_config (idempotent) and seeds the global
// ai_config row from the current defaults. Requires POSTGRES_URL (same as
// db:push). Additive only — drizzle-kit push is avoided because it prompts
// interactively; this script is deterministic and safe to re-run.
import { sql } from "drizzle-orm";

import { db } from "../client";
import { AI_CONFIG_ID } from "../schema";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_config" (
      "id" uuid PRIMARY KEY NOT NULL,
      "provider_kind" text NOT NULL DEFAULT 'gateway',
      "base_url" text NOT NULL DEFAULT 'https://ai-gateway.vercel.sh',
      "chat_model" text NOT NULL,
      "normalize_model" text NOT NULL,
      "embed_model" text NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "workspace_ai_config" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL UNIQUE REFERENCES "workspace"("id") ON DELETE cascade,
      "chat_model" text,
      "normalize_model" text,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  // Seed the singleton global row with today's defaults. Idempotent.
  await db.execute(sql`
    INSERT INTO "ai_config"
      ("id", "provider_kind", "base_url", "chat_model", "normalize_model", "embed_model")
    VALUES
      (${AI_CONFIG_ID}, 'gateway', 'https://ai-gateway.vercel.sh',
       'anthropic/claude-sonnet-4.6', 'google/gemini-2.5-flash', 'openai/text-embedding-3-small')
    ON CONFLICT ("id") DO NOTHING
  `);

  console.log("ai_config + workspace_ai_config ready; global row seeded.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
