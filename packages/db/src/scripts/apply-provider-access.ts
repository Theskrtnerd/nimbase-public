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
    CREATE TABLE IF NOT EXISTS "provider_access_resource" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "connection_id" uuid REFERENCES "source_connection"("id") ON DELETE RESTRICT,
      "provider" text NOT NULL,
      "kind" text NOT NULL,
      "external_id" text NOT NULL,
      "name" text,
      "state" text DEFAULT 'active' NOT NULL,
      "current_access_policy_id" uuid REFERENCES "provider_access_policy"("id") ON DELETE RESTRICT,
      "last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "provider_access_resource_state_check"
        CHECK ("state" IN ('active', 'inaccessible', 'deleted')),
      CONSTRAINT "provider_access_resource_policy_state_check" CHECK (
        ("state" = 'active' AND "current_access_policy_id" IS NOT NULL)
        OR ("state" IN ('inaccessible', 'deleted') AND "current_access_policy_id" IS NULL)
      )
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "provider_access_resource_connection_identity_idx"
      ON "provider_access_resource" ("connection_id", "kind", "external_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_resource_workspace_idx"
      ON "provider_access_resource" ("workspace_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_resource_current_policy_idx"
      ON "provider_access_resource" ("current_access_policy_id")
  `);
  // Early development revisions used SET NULL directly on delete, which could
  // race an in-flight crawl. Deletion now nulls resources only after revoking
  // them in the same transaction; the FK prevents any resource from escaping.
  await db.execute(sql`
    ALTER TABLE "provider_access_resource"
      DROP CONSTRAINT IF EXISTS "provider_access_resource_connection_id_fkey"
  `);
  await db.execute(sql`
    ALTER TABLE "provider_access_resource"
      DROP CONSTRAINT IF EXISTS "provider_access_resource_connection_id_source_connection_id_fk"
  `);
  await db.execute(
    sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'provider_access_resource_connection_fk'
        ) THEN
          ALTER TABLE "provider_access_resource"
            ADD CONSTRAINT "provider_access_resource_connection_fk"
            FOREIGN KEY ("connection_id") REFERENCES "source_connection"("id")
            ON DELETE RESTRICT;
        END IF;
      END $$;
    `),
  );

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "provider_access_observation" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
      "resource_id" uuid NOT NULL REFERENCES "provider_access_resource"("id") ON DELETE CASCADE,
      "state" text NOT NULL,
      "access_policy_id" uuid REFERENCES "provider_access_policy"("id") ON DELETE RESTRICT,
      "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "provider_access_observation_state_check"
        CHECK ("state" IN ('active', 'inaccessible', 'deleted')),
      CONSTRAINT "provider_access_observation_policy_state_check" CHECK (
        ("state" = 'active' AND "access_policy_id" IS NOT NULL)
        OR ("state" IN ('inaccessible', 'deleted') AND "access_policy_id" IS NULL)
      )
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_observation_resource_observed_idx"
      ON "provider_access_observation" ("resource_id", "observed_at")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "provider_access_observation_workspace_idx"
      ON "provider_access_observation" ("workspace_id")
  `);

  await db.execute(sql`
    ALTER TABLE "source"
      ADD COLUMN IF NOT EXISTS "access_policy_id" uuid
      REFERENCES "provider_access_policy"("id") ON DELETE RESTRICT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "source_access_policy_idx"
      ON "source" ("access_policy_id")
  `);
  await db.execute(sql`
    ALTER TABLE "source"
      ADD COLUMN IF NOT EXISTS "access_resource_id" uuid
      REFERENCES "provider_access_resource"("id") ON DELETE RESTRICT
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "source_access_resource_idx"
      ON "source" ("access_resource_id")
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

  // Existing source rows did not distinguish a content id from its ACL
  // resource. Backfill one item-scoped resource using the newest source policy
  // for each connected external id. ON CONFLICT does nothing so rerunning this
  // migration can never roll a resource back after a newer ACL observation.
  await db.execute(sql`
    INSERT INTO "provider_access_resource" (
      "workspace_id", "connection_id", "provider", "kind", "external_id",
      "state", "current_access_policy_id", "last_verified_at"
    )
    SELECT DISTINCT ON (source.workspace_id, source.connection_id, source.external_id)
      source.workspace_id,
      source.connection_id,
      connection.provider,
      'item',
      source.external_id,
      'active',
      source.access_policy_id,
      source.created_at
    FROM "source" source
    JOIN "source_connection" connection ON connection.id = source.connection_id
    WHERE source.connection_id IS NOT NULL
      AND source.external_id IS NOT NULL
      AND source.access_policy_id IS NOT NULL
    ORDER BY
      source.workspace_id,
      source.connection_id,
      source.external_id,
      source.created_at DESC,
      source.id DESC
    ON CONFLICT ("connection_id", "kind", "external_id") DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "provider_access_observation" (
      "workspace_id", "resource_id", "state", "access_policy_id", "observed_at"
    )
    SELECT
      resource.workspace_id,
      resource.id,
      resource.state,
      resource.current_access_policy_id,
      resource.last_verified_at
    FROM "provider_access_resource" resource
    WHERE NOT EXISTS (
      SELECT 1
      FROM "provider_access_observation" observation
      WHERE observation.resource_id = resource.id
    )
  `);
  await db.execute(sql`
    UPDATE "source" source
    SET "access_resource_id" = resource.id
    FROM "provider_access_resource" resource
    WHERE source.access_resource_id IS NULL
      AND source.connection_id = resource.connection_id
      AND source.external_id = resource.external_id
      AND resource.kind = 'item'
  `);
  console.log(
    "Provider access policies, resources, observations, and source fences ensured.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
