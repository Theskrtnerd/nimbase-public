// Additive migration for stable, workspace-scoped widget slugs:
//   pnpm -F @acme/db migrate:widget-slug       (dev)
//   pnpm -F @acme/db migrate:widget-slug:prod  (prod)
import { sql } from "drizzle-orm";

import { db } from "../client";
import { nextAvailableSlug, slugifyName } from "../slug";

async function main() {
  await db.execute(sql`
    ALTER TABLE "widget" ADD COLUMN IF NOT EXISTS "slug" text;
  `);

  const existing = await db.execute<{
    workspaceId: string;
    slug: string;
  }>(sql`
    SELECT "workspace_id" AS "workspaceId", "slug"
    FROM "widget"
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
    FROM "widget"
    WHERE "slug" IS NULL
    ORDER BY "created_at", "id";
  `);
  for (const row of missing.rows) {
    const used = usedByWorkspace.get(row.workspaceId) ?? new Set<string>();
    const slug = nextAvailableSlug(slugifyName(row.name) || "widget", used);
    used.add(slug);
    usedByWorkspace.set(row.workspaceId, used);
    await db.execute(
      sql`UPDATE "widget" SET "slug" = ${slug} WHERE "id" = ${row.id};`,
    );
  }

  await db.execute(sql`
    ALTER TABLE "widget" ALTER COLUMN "slug" SET NOT NULL;
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "widget_workspace_slug_idx"
      ON "widget" ("workspace_id", "slug");
  `);
  console.log("widget slug migration applied");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
