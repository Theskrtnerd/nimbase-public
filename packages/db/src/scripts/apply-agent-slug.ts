// Additive migration for stable, workspace-scoped deployment slugs:
//   pnpm -F @acme/db migrate:agent-slug       (dev)
//   pnpm -F @acme/db migrate:agent-slug:prod  (prod)
// Existing agents are backfilled from their names. Safe to re-run.
import { sql } from "drizzle-orm";

import { db } from "../client";
import { nextAvailableSlug, slugifyName } from "../slug";

async function main() {
  await db.execute(sql`
    ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "slug" text;
  `);

  const existing = await db.execute<{
    workspaceId: string;
    slug: string;
  }>(sql`
    SELECT "workspace_id" AS "workspaceId", "slug"
    FROM "agent"
    WHERE "slug" IS NOT NULL;
  `);
  const usedByWorkspace = new Map<string, Set<string>>();
  for (const row of existing.rows) {
    const used = usedByWorkspace.get(row.workspaceId) ?? new Set<string>();
    used.add(row.slug);
    usedByWorkspace.set(row.workspaceId, used);
  }

  const missing = await db.execute<{
    id: string;
    workspaceId: string;
    name: string;
  }>(sql`
    SELECT "id", "workspace_id" AS "workspaceId", "name"
    FROM "agent"
    WHERE "slug" IS NULL
    ORDER BY "created_at", "id";
  `);
  for (const row of missing.rows) {
    const used = usedByWorkspace.get(row.workspaceId) ?? new Set<string>();
    const base = slugifyName(row.name) || "agent";
    const slug = nextAvailableSlug(base, used);
    used.add(slug);
    usedByWorkspace.set(row.workspaceId, used);
    await db.execute(
      sql`UPDATE "agent" SET "slug" = ${slug} WHERE "id" = ${row.id};`,
    );
  }

  await db.execute(sql`
    ALTER TABLE "agent" ALTER COLUMN "slug" SET NOT NULL;
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "agent_workspace_slug_idx"
      ON "agent" ("workspace_id", "slug");
  `);

  console.log("agent slug migration applied");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
