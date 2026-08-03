// Additive, idempotent migration for provider-derived ACL snapshots.
// Existing connected provider evidence is backfilled to the connection
// creator only. This is deliberately conservative: a recrawl replaces the
// legacy policy with the provider's current ACL.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "provider_access_policy" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "fingerprint" text NOT NULL,
      "provider" text NOT NULL,
      "tenant_id" text NOT NULL,
      "visibility" text NOT NULL,
      "completeness" text NOT NULL,
      "definition" jsonb NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "provider_access_policy_visibility_check"
        CHECK ("visibility" IN ('workspace', 'restricted')),
      CONSTRAINT "provider_access_policy_completeness_check"
        CHECK ("completeness" IN ('complete', 'partial'))
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "provider_access_policy_workspace_fingerprint_idx"
      ON "provider_access_policy" ("workspace_id", "fingerprint")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_policy_workspace_visibility_idx"
      ON "provider_access_policy" ("workspace_id", "visibility")
  `);
  await db.execute(
    sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_access_policy_visibility_check') THEN
          ALTER TABLE "provider_access_policy" ADD CONSTRAINT "provider_access_policy_visibility_check"
            CHECK ("visibility" IN ('workspace', 'restricted'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_access_policy_completeness_check') THEN
          ALTER TABLE "provider_access_policy" ADD CONSTRAINT "provider_access_policy_completeness_check"
            CHECK ("completeness" IN ('complete', 'partial'));
        END IF;
      END $$;
    `),
  );

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "provider_access_grant" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "policy_id" uuid NOT NULL REFERENCES "provider_access_policy"("id") ON DELETE CASCADE,
      "principal_type" text NOT NULL,
      "user_profile_id" uuid,
      "email" text,
      "domain" text,
      "provider" text,
      "tenant_id" text,
      "subject" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "provider_access_grant_shape_check" CHECK (
        ("principal_type" = 'user_profile' AND "user_profile_id" IS NOT NULL
          AND "email" IS NULL AND "domain" IS NULL AND "provider" IS NULL
          AND "tenant_id" IS NULL AND "subject" IS NULL)
        OR ("principal_type" = 'email' AND "email" IS NOT NULL
          AND "user_profile_id" IS NULL AND "domain" IS NULL AND "provider" IS NULL
          AND "tenant_id" IS NULL AND "subject" IS NULL)
        OR ("principal_type" = 'domain' AND "domain" IS NOT NULL
          AND "user_profile_id" IS NULL AND "email" IS NULL AND "provider" IS NULL
          AND "tenant_id" IS NULL AND "subject" IS NULL)
        OR ("principal_type" = 'external_identity' AND "provider" IS NOT NULL
          AND "tenant_id" IS NOT NULL AND "subject" IS NOT NULL
          AND "user_profile_id" IS NULL AND "email" IS NULL AND "domain" IS NULL)
      )
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "provider_access_grant_identity_idx"
      ON "provider_access_grant" (
        "policy_id", "principal_type", "user_profile_id", "email", "domain",
        "provider", "tenant_id", "subject"
      ) NULLS NOT DISTINCT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_grant_policy_idx"
      ON "provider_access_grant" ("policy_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_grant_profile_idx"
      ON "provider_access_grant" ("user_profile_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_grant_email_idx"
      ON "provider_access_grant" ("email")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_grant_external_idx"
      ON "provider_access_grant" ("provider", "tenant_id", "subject")
  `);
  await db.execute(
    sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_access_grant_shape_check') THEN
          ALTER TABLE "provider_access_grant" ADD CONSTRAINT "provider_access_grant_shape_check" CHECK (
            ("principal_type" = 'user_profile' AND "user_profile_id" IS NOT NULL
              AND "email" IS NULL AND "domain" IS NULL AND "provider" IS NULL
              AND "tenant_id" IS NULL AND "subject" IS NULL)
            OR ("principal_type" = 'email' AND "email" IS NOT NULL
              AND "user_profile_id" IS NULL AND "domain" IS NULL AND "provider" IS NULL
              AND "tenant_id" IS NULL AND "subject" IS NULL)
            OR ("principal_type" = 'domain' AND "domain" IS NOT NULL
              AND "user_profile_id" IS NULL AND "email" IS NULL AND "provider" IS NULL
              AND "tenant_id" IS NULL AND "subject" IS NULL)
            OR ("principal_type" = 'external_identity' AND "provider" IS NOT NULL
              AND "tenant_id" IS NOT NULL AND "subject" IS NOT NULL
              AND "user_profile_id" IS NULL AND "email" IS NULL AND "domain" IS NULL)
          );
        END IF;
      END $$;
    `),
  );

  await db.execute(sql`
    ALTER TABLE "source"
      ADD COLUMN IF NOT EXISTS "access_policy_id" uuid
      REFERENCES "provider_access_policy"("id") ON DELETE RESTRICT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "source_access_policy_idx"
      ON "source" ("access_policy_id")
  `);
  // One immutable, owner-only snapshot per existing connection. If its
  // creator no longer has a profile, grants is empty and access fails closed.
  await db.execute(sql`
    INSERT INTO "provider_access_policy" (
      "workspace_id", "fingerprint", "provider", "tenant_id",
      "visibility", "completeness", "definition"
    )
    SELECT
      connection.workspace_id,
      'legacy-connection:' || connection.id::text,
      connection.provider,
      connection.route_key,
      'restricted',
      'partial',
      jsonb_build_object(
        'version', 1,
        'provider', connection.provider,
        'tenantId', connection.route_key,
        'visibility', 'restricted',
        'completeness', 'partial',
        'grants', CASE
          WHEN member.user_profile_id IS NULL THEN '[]'::jsonb
          ELSE jsonb_build_array(jsonb_build_object(
            'type', 'user_profile',
            'userProfileId', member.user_profile_id
          ))
        END
      )
    FROM "source_connection" connection
    LEFT JOIN "workspace_member" member
      ON member.workspace_id = connection.workspace_id
     AND member.user_id = connection.created_by_user_id
    ON CONFLICT ("workspace_id", "fingerprint") DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "provider_access_grant" (
      "workspace_id", "policy_id", "principal_type", "user_profile_id"
    )
    SELECT
      policy.workspace_id,
      policy.id,
      'user_profile',
      member.user_profile_id
    FROM "provider_access_policy" policy
    JOIN "source_connection" connection
      ON policy.workspace_id = connection.workspace_id
     AND policy.fingerprint = 'legacy-connection:' || connection.id::text
    JOIN "workspace_member" member
      ON member.workspace_id = connection.workspace_id
     AND member.user_id = connection.created_by_user_id
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    UPDATE "source" source
    SET "access_policy_id" = policy.id
    FROM "source_connection" connection
    JOIN "provider_access_policy" policy
      ON policy.workspace_id = connection.workspace_id
     AND policy.fingerprint = 'legacy-connection:' || connection.id::text
    WHERE source.connection_id = connection.id
      AND source.access_policy_id IS NULL
  `);
  console.log("Provider access policies, grants, and resource fences ensured.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
