// One-off additive migration creating the wiki_node_tag derived index:
//   pnpm -F @acme/db migrate:node-tags       (dev)
//   pnpm -F @acme/db migrate:node-tags:prod  (prod)
// Adds the table the gardener's tag index writes to. drizzle-kit push is
// avoided because it hangs in non-TTY. This script is deterministic and safe to
// re-run. Requires POSTGRES_URL (same as db:push). Purely additive — no
// existing rows are touched; untagged notes simply have no rows here.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "wiki_node_tag" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" uuid NOT NULL,
      "node_id" uuid NOT NULL,
      "tag" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  // FK constraints, named exactly as drizzle-kit would, so a future push sees
  // them as already present instead of recreating them.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'wiki_node_tag_workspace_id_workspace_id_fk'
      ) THEN
        ALTER TABLE "wiki_node_tag"
          ADD CONSTRAINT "wiki_node_tag_workspace_id_workspace_id_fk"
          FOREIGN KEY ("workspace_id")
          REFERENCES "workspace"("id") ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'wiki_node_tag_node_id_wiki_node_id_fk'
      ) THEN
        ALTER TABLE "wiki_node_tag"
          ADD CONSTRAINT "wiki_node_tag_node_id_wiki_node_id_fk"
          FOREIGN KEY ("node_id")
          REFERENCES "wiki_node"("id") ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "wiki_node_tag_node_tag_idx"
      ON "wiki_node_tag" ("node_id", "tag");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "wiki_node_tag_ws_tag_idx"
      ON "wiki_node_tag" ("workspace_id", "tag");
  `);

  console.log("wiki_node_tag table + indexes ensured.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
