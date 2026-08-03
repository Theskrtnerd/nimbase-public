// Consolidate standalone widgets into Agent + AgentConnection:
//   pnpm -F @acme/db migrate:widget-agent-interface       (dev)
//   pnpm -F @acme/db migrate:widget-agent-interface:prod  (prod)
//
// Existing public keys and turn history are preserved. The standalone widget
// tables are dropped only after every row has been copied. Safe to re-run.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    ALTER TABLE "agent_connection"
      ADD COLUMN IF NOT EXISTS "interface_config" jsonb
  `);
  await db.execute(sql`
    ALTER TABLE "agent_turn"
      ADD COLUMN IF NOT EXISTS "ip_hash" text
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_turn_session_idx"
      ON "agent_turn" ("connection_id", "channel_key")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_turn_ip_created_idx"
      ON "agent_turn" ("ip_hash", "created_at")
  `);

  await db.execute(sql`
    DO $migration$
    DECLARE
      source_widget record;
      target_agent_id uuid;
      target_connection_id uuid;
      target_slug text;
    BEGIN
      IF to_regclass('public.widget') IS NULL THEN
        RETURN;
      END IF;

      FOR source_widget IN SELECT * FROM "widget" ORDER BY "created_at", "id"
      LOOP
        target_agent_id := source_widget.id;
        IF EXISTS (
          SELECT 1 FROM "agent" WHERE "id" = target_agent_id
        ) THEN
          target_agent_id := gen_random_uuid();
        END IF;

        target_slug := source_widget.slug;
        IF EXISTS (
          SELECT 1
          FROM "agent"
          WHERE "workspace_id" = source_widget.workspace_id
            AND "slug" = target_slug
        ) THEN
          target_slug :=
            left(source_widget.slug, 48)
            || '-widget-'
            || left(source_widget.id::text, 8);
        END IF;

        INSERT INTO "agent" (
          "id",
          "workspace_id",
          "slug",
          "name",
          "instructions",
          "target_folder_id",
          "daily_cost_cap_cents",
          "enabled",
          "created_by_user_id",
          "created_at",
          "updated_at"
        ) VALUES (
          target_agent_id,
          source_widget.workspace_id,
          target_slug,
          source_widget.name,
          source_widget.instructions,
          source_widget.folder_id,
          source_widget.daily_cost_cap_cents,
          true,
          source_widget.created_by_user_id,
          source_widget.created_at,
          source_widget.updated_at
        );

        INSERT INTO "access_grant" (
          "workspace_id",
          "principal_type",
          "principal_id",
          "folder_id",
          "role",
          "created_by_user_id",
          "created_at"
        ) VALUES (
          source_widget.workspace_id,
          'agent',
          target_agent_id::text,
          source_widget.folder_id,
          'viewer',
          source_widget.created_by_user_id,
          source_widget.created_at
        )
        ON CONFLICT ON CONSTRAINT "access_grant_principal_folder_idx"
          DO NOTHING;

        target_connection_id := source_widget.id;
        IF EXISTS (
          SELECT 1 FROM "agent_connection" WHERE "id" = target_connection_id
        ) THEN
          target_connection_id := gen_random_uuid();
        END IF;

        INSERT INTO "agent_connection" (
          "id",
          "agent_id",
          "workspace_id",
          "platform",
          "route_key",
          "interface_config",
          "status",
          "created_by_user_id",
          "created_at",
          "updated_at"
        ) VALUES (
          target_connection_id,
          target_agent_id,
          source_widget.workspace_id,
          'widget',
          source_widget.public_key,
          jsonb_build_object(
            'greeting', source_widget.greeting,
            'allowedDomains', to_jsonb(source_widget.allowed_domains),
            'theme', coalesce(source_widget.theme, '{}'::jsonb)
          ),
          source_widget.status,
          source_widget.created_by_user_id,
          source_widget.created_at,
          source_widget.updated_at
        );

        IF to_regclass('public.widget_turn') IS NOT NULL THEN
          INSERT INTO "agent_turn" (
            "id",
            "agent_id",
            "connection_id",
            "workspace_id",
            "channel_key",
            "ip_hash",
            "question",
            "answer",
            "tokens",
            "cost_cents",
            "error",
            "created_at"
          )
          SELECT
            CASE
              WHEN EXISTS (
                SELECT 1 FROM "agent_turn" existing
                WHERE existing."id" = turn."id"
              ) THEN gen_random_uuid()
              ELSE turn."id"
            END,
            target_agent_id,
            target_connection_id,
            turn."workspace_id",
            turn."visitor_session_id",
            turn."ip_hash",
            turn."question",
            turn."answer",
            turn."tokens",
            turn."cost_cents",
            turn."error",
            turn."created_at"
          FROM "widget_turn" turn
          WHERE turn."widget_id" = source_widget.id;
        END IF;
      END LOOP;

      UPDATE "spend_ledger" SET "kind" = 'agent' WHERE "kind" = 'widget';

      DROP TABLE IF EXISTS "widget_turn";
      DROP TABLE "widget";
    END
    $migration$;
  `);

  console.log("widget agent-interface migration applied");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
