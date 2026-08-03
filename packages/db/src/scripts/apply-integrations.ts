// One-off, additive migration for the integrations / scheduled-crawl feature:
//   pnpm -F @acme/db migrate:integrations       (dev)
//   pnpm -F @acme/db migrate:integrations:prod  (prod)
// Creates source_connection + crawl_run and adds source.connection_id /
// source.external_id. Everything is IF NOT EXISTS so it's deterministic and
// safe to re-run. Requires POSTGRES_URL (same as db:push).
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "source_connection" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "provider" text NOT NULL,
      "display_name" text,
      "auth_kind" text NOT NULL DEFAULT 'connector_http',
      "connector_url" text NOT NULL,
      "route_key" text NOT NULL,
      "secrets_encrypted" text,
      "token_expires_at" timestamp with time zone,
      "target_folder_id" uuid REFERENCES "wiki_node"("id") ON DELETE SET NULL,
      "config" jsonb,
      "status" text NOT NULL DEFAULT 'active',
      "interval_seconds" integer NOT NULL DEFAULT 86400,
      "cursor" jsonb,
      "next_run_at" timestamp with time zone,
      "last_run_at" timestamp with time zone,
      "last_success_at" timestamp with time zone,
      "last_error" text,
      "consecutive_failures" integer NOT NULL DEFAULT 0,
      "created_by_user_id" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "source_connection_route_idx"
      ON "source_connection" ("workspace_id", "provider", "route_key")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "source_connection_due_idx"
      ON "source_connection" ("status", "next_run_at")
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crawl_run" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "connection_id" uuid NOT NULL REFERENCES "source_connection"("id") ON DELETE CASCADE,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "status" text NOT NULL DEFAULT 'running',
      "items_seen" integer NOT NULL DEFAULT 0,
      "items_ingested" integer NOT NULL DEFAULT 0,
      "items_skipped" integer NOT NULL DEFAULT 0,
      "error" text,
      "started_at" timestamp with time zone DEFAULT now() NOT NULL,
      "finished_at" timestamp with time zone
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crawl_run_connection_started_idx"
      ON "crawl_run" ("connection_id", "started_at")
  `);

  await db.execute(sql`
    ALTER TABLE "source" ADD COLUMN IF NOT EXISTS "connection_id" uuid
      REFERENCES "source_connection"("id") ON DELETE SET NULL
  `);
  await db.execute(sql`
    ALTER TABLE "source" ADD COLUMN IF NOT EXISTS "external_id" text
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "source_connection_idx"
      ON "source" ("connection_id")
  `);

  console.log(
    "integrations: source_connection + crawl_run ensured; source.connection_id / external_id added.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
