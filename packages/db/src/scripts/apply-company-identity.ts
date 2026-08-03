// Replace audience projections with direct deployment folder scopes and add
// company-scoped user profiles:
//   pnpm -F @acme/db migrate:company-identity       (dev)
//   pnpm -F @acme/db migrate:company-identity:prod  (prod)
//
// Existing projected memory folders are deliberately preserved. Only the
// audience configuration/fan-out tables and columns are removed.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_profile" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "primary_email" text,
      "display_name" text,
      "given_name" text,
      "family_name" text,
      "title" text,
      "department" text,
      "timezone" text,
      "status" text NOT NULL DEFAULT 'active',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_profile_workspace_email_idx"
      ON "user_profile" ("workspace_id", "primary_email")
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_profile_workspace_id_idx"
      ON "user_profile" ("workspace_id", "id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_profile_workspace_status_idx"
      ON "user_profile" ("workspace_id", "status")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_profile_email" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "user_profile_id" uuid NOT NULL,
      "email" text NOT NULL,
      "verified_at" timestamptz NOT NULL DEFAULT now(),
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_profile_email_workspace_email_idx"
      ON "user_profile_email" ("workspace_id", "email")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_profile_email_profile_idx"
      ON "user_profile_email" ("user_profile_id")
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'user_profile_email'
          AND constraint_name = 'user_profile_email_workspace_profile_fk'
      ) THEN
        ALTER TABLE "user_profile_email"
          ADD CONSTRAINT "user_profile_email_workspace_profile_fk"
          FOREIGN KEY ("workspace_id", "user_profile_id")
          REFERENCES "user_profile"("workspace_id", "id")
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "external_identity" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "user_profile_id" uuid NOT NULL,
      "provider" text NOT NULL,
      "tenant_id" text NOT NULL,
      "subject" text NOT NULL,
      "email" text,
      "email_verified" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "external_identity_provider_subject_idx"
      ON "external_identity" ("workspace_id", "provider", "tenant_id", "subject")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "external_identity_profile_idx"
      ON "external_identity" ("user_profile_id")
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'external_identity'
          AND constraint_name = 'external_identity_workspace_profile_fk'
      ) THEN
        ALTER TABLE "external_identity"
          ADD CONSTRAINT "external_identity_workspace_profile_fk"
          FOREIGN KEY ("workspace_id", "user_profile_id")
          REFERENCES "user_profile"("workspace_id", "id")
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    ALTER TABLE "workspace_member"
      ADD COLUMN IF NOT EXISTS "user_profile_id" uuid
  `);

  // Verified email is the only cross-provider join signal. Members without an
  // email receive an isolated profile keyed by the membership UUID.
  await db.execute(sql`
    INSERT INTO "user_profile" (
      "workspace_id", "primary_email", "display_name"
    )
    SELECT
      "workspace_id",
      lower(trim("email")),
      max("name")
    FROM "workspace_member"
    WHERE nullif(trim("email"), '') IS NOT NULL
    GROUP BY "workspace_id", lower(trim("email"))
    ON CONFLICT ("workspace_id", "primary_email") DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "user_profile" ("id", "workspace_id", "display_name")
    SELECT "id", "workspace_id", "name"
    FROM "workspace_member"
    WHERE nullif(trim("email"), '') IS NULL
    ON CONFLICT ("id") DO NOTHING
  `);
  await db.execute(sql`
    UPDATE "workspace_member" AS member
    SET "user_profile_id" = profile."id"
    FROM "user_profile" AS profile
    WHERE member."user_profile_id" IS NULL
      AND profile."workspace_id" = member."workspace_id"
      AND (
        (
          nullif(trim(member."email"), '') IS NOT NULL
          AND profile."primary_email" = lower(trim(member."email"))
        )
        OR (
          nullif(trim(member."email"), '') IS NULL
          AND profile."id" = member."id"
        )
      )
  `);
  await db.execute(sql`
    INSERT INTO "user_profile_email" (
      "workspace_id", "user_profile_id", "email"
    )
    SELECT
      "workspace_id",
      "user_profile_id",
      lower(trim("email"))
    FROM "workspace_member"
    WHERE "user_profile_id" IS NOT NULL
      AND nullif(trim("email"), '') IS NOT NULL
    ON CONFLICT ("workspace_id", "email") DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "external_identity" (
      "workspace_id",
      "user_profile_id",
      "provider",
      "tenant_id",
      "subject",
      "email",
      "email_verified"
    )
    SELECT
      "workspace_id",
      "user_profile_id",
      'clerk',
      'nimbase',
      "user_id",
      nullif(lower(trim("email")), ''),
      nullif(trim("email"), '') IS NOT NULL
    FROM "workspace_member"
    WHERE "user_profile_id" IS NOT NULL
    ON CONFLICT ("workspace_id", "provider", "tenant_id", "subject")
      DO NOTHING
  `);
  await db.execute(sql`
    ALTER TABLE "workspace_member"
      ALTER COLUMN "user_profile_id" SET NOT NULL
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'workspace_member'
          AND constraint_name = 'workspace_member_workspace_profile_fk'
      ) THEN
        ALTER TABLE "workspace_member"
          ADD CONSTRAINT "workspace_member_workspace_profile_fk"
          FOREIGN KEY ("workspace_id", "user_profile_id")
          REFERENCES "user_profile"("workspace_id", "id")
          ON DELETE RESTRICT;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "group_mcp" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "folder_id" uuid REFERENCES "wiki_node"("id") ON DELETE RESTRICT,
      "slug" text NOT NULL,
      "name" text NOT NULL,
      "instructions" text NOT NULL DEFAULT '',
      "enabled" boolean NOT NULL DEFAULT true,
      "tools" text[] NOT NULL DEFAULT '{search,get_note,list_sources}'::text[],
      "auth_methods" text[] NOT NULL DEFAULT '{oauth}'::text[],
      "artifact_visibility" text NOT NULL DEFAULT 'private',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "group_mcp_workspace_slug_idx"
      ON "group_mcp" ("workspace_id", "slug")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "group_mcp_workspace_idx"
      ON "group_mcp" ("workspace_id")
  `);
  await db.execute(sql`
    ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "group_mcp_id" uuid
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF to_regclass('public.audience') IS NOT NULL THEN
        INSERT INTO "group_mcp" (
          "id",
          "workspace_id",
          "folder_id",
          "slug",
          "name",
          "instructions",
          "enabled",
          "tools",
          "auth_methods",
          "artifact_visibility",
          "created_at",
          "updated_at"
        )
        SELECT
          "id",
          "workspace_id",
          "folder_id",
          "slug",
          "name",
          "lens",
          "mcp_enabled",
          "mcp_tools",
          "mcp_auth_methods",
          "artifact_visibility",
          "created_at",
          "updated_at"
        FROM "audience"
        WHERE "mcp_enabled" = true
        ON CONFLICT ("workspace_id", "slug") DO NOTHING;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'api_token'
            AND column_name = 'audience_id'
        ) THEN
          UPDATE "api_token"
          SET "group_mcp_id" = "audience_id"
          WHERE "audience_id" IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM "group_mcp"
              WHERE "group_mcp"."id" = "api_token"."audience_id"
            );
        END IF;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'api_token'
          AND constraint_name = 'api_token_group_mcp_id_group_mcp_id_fk'
      ) THEN
        ALTER TABLE "api_token"
          ADD CONSTRAINT "api_token_group_mcp_id_group_mcp_id_fk"
          FOREIGN KEY ("group_mcp_id") REFERENCES "group_mcp"("id")
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    ALTER TABLE IF EXISTS "widget" ADD COLUMN IF NOT EXISTS "folder_id" uuid
  `);
  await db.execute(sql`
    ALTER TABLE "doc_site" ADD COLUMN IF NOT EXISTS "folder_id" uuid
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF to_regclass('public.audience') IS NOT NULL
        AND to_regclass('public.widget') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'widget' AND column_name = 'audience_id'
        ) THEN
        UPDATE "widget" AS deployment
        SET "folder_id" = config."folder_id"
        FROM "audience" AS config
        WHERE deployment."folder_id" IS NULL
          AND deployment."audience_id" = config."id";
      END IF;

      IF to_regclass('public.audience') IS NOT NULL AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'doc_site' AND column_name = 'audience_id'
      ) THEN
        UPDATE "doc_site" AS deployment
        SET "folder_id" = config."folder_id"
        FROM "audience" AS config
        WHERE deployment."folder_id" IS NULL
          AND deployment."audience_id" = config."id";

      END IF;

      IF to_regclass('public.audience') IS NOT NULL AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'artifact' AND column_name = 'audience_id'
      ) THEN
        UPDATE "artifact" AS artifact
        SET "target_folder_id" = config."folder_id"
        FROM "audience" AS config
        WHERE artifact."target_folder_id" IS NULL
          AND artifact."audience_id" = config."id";
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF to_regclass('public.widget') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'widget'
          AND constraint_name = 'widget_folder_id_wiki_node_id_fk'
      ) THEN
        ALTER TABLE "widget"
          ADD CONSTRAINT "widget_folder_id_wiki_node_id_fk"
          FOREIGN KEY ("folder_id") REFERENCES "wiki_node"("id")
          ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'doc_site'
          AND constraint_name = 'doc_site_folder_id_wiki_node_id_fk'
      ) THEN
        ALTER TABLE "doc_site"
          ADD CONSTRAINT "doc_site_folder_id_wiki_node_id_fk"
          FOREIGN KEY ("folder_id") REFERENCES "wiki_node"("id")
          ON DELETE RESTRICT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "doc_site_folder_idx" ON "doc_site" ("folder_id")
  `);

  // Fragment jobs are obsolete. Canonical jobs and their memory remain.
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'compile_job'
          AND column_name = 'audience_id'
      ) THEN
        DELETE FROM "compile_job" WHERE "audience_id" IS NOT NULL;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS "compile_job" DROP COLUMN IF EXISTS "audience_id" CASCADE
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS "api_token" DROP COLUMN IF EXISTS "audience_id" CASCADE
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS "artifact" DROP COLUMN IF EXISTS "audience_id" CASCADE
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS "widget" DROP COLUMN IF EXISTS "audience_id" CASCADE
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS "doc_site" DROP COLUMN IF EXISTS "audience_id" CASCADE
  `);
  await db.execute(sql`
    DROP TABLE IF EXISTS "source_audience" CASCADE
  `);
  await db.execute(sql`
    DROP TABLE IF EXISTS "audience" CASCADE
  `);

  console.log("company identity migration applied; audience layer removed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
