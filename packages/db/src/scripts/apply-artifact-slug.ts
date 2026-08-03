// Backfill stable, globally unique artifact slugs and make them mandatory:
//   pnpm -F @acme/db migrate:artifact-slug       (dev)
//   pnpm -F @acme/db migrate:artifact-slug:prod  (prod)
// Existing non-null share slugs never change. Safe to re-run.
import { sql } from "drizzle-orm";

import { db } from "../client";
import { nextAvailableSlug, resourceSlugBase } from "../slug";

async function main() {
  const existing = await db.execute<{ slug: string }>(sql`
    SELECT "slug" FROM "artifact" WHERE "slug" IS NOT NULL;
  `);
  const used = new Set(existing.rows.map((row) => row.slug));

  const missing = await db.execute<{ id: string; title: string }>(sql`
    SELECT "id", "title"
    FROM "artifact"
    WHERE "slug" IS NULL
    ORDER BY "created_at", "id";
  `);
  for (const row of missing.rows) {
    const slug = nextAvailableSlug(
      resourceSlugBase(row.title, "artifact"),
      used,
    );
    used.add(slug);
    await db.execute(
      sql`UPDATE "artifact" SET "slug" = ${slug} WHERE "id" = ${row.id};`,
    );
  }

  await db.execute(sql`
    ALTER TABLE "artifact" ALTER COLUMN "slug" SET NOT NULL;
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "artifact_slug_unique"
      ON "artifact" ("slug");
  `);

  console.log("artifact slug migration applied");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
