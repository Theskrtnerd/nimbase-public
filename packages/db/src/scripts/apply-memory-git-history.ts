// Additive, idempotent migration for durable memory mutations and their Git
// projection. Existing live memory is captured as one baseline mutation per
// workspace; later mutations are journaled by GardenerFs itself.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "memory_mutation" (
      "sequence" bigserial NOT NULL,
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "changes" jsonb NOT NULL,
      "message" text NOT NULL,
      "source_id" uuid REFERENCES "source"("id") ON DELETE SET NULL,
      "job_id" uuid,
      "git_commit_sha" text,
      "projected_at" timestamp with time zone,
      "projection_attempts" integer DEFAULT 0 NOT NULL,
      "projection_error" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "memory_mutation_sequence_idx"
      ON "memory_mutation" ("sequence")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "memory_mutation_workspace_pending_idx"
      ON "memory_mutation" ("workspace_id", "sequence")
      WHERE "projected_at" IS NULL
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "memory_git_ref" (
      "workspace_id" uuid PRIMARY KEY REFERENCES "workspace"("id") ON DELETE CASCADE,
      "head_sha" text,
      "entries" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(sql`
    INSERT INTO "memory_mutation" ("workspace_id", "changes", "message")
    SELECT
      node."workspace_id",
      jsonb_agg(
        jsonb_build_object(
          'type', 'upsert',
          'path', node."path",
          'versionId', node."current_version_id"
        )
        ORDER BY node."path"
      ),
      'Initialize memory history'
    FROM "wiki_node" AS node
    WHERE node."deleted_at" IS NULL
      AND node."current_version_id" IS NOT NULL
      AND node."kind" <> 'folder'
      AND NOT EXISTS (
        SELECT 1
        FROM "memory_mutation" AS mutation
        WHERE mutation."workspace_id" = node."workspace_id"
      )
    GROUP BY node."workspace_id"
  `);
}

main()
  .then(() => {
    console.info("Memory Git history schema applied.");
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
