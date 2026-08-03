// One-off migration for the original/raw.md capture split:
//   pnpm -F @acme/db migrate:source-columns       (dev)
//   pnpm -F @acme/db migrate:source-columns:prod  (prod)
// Renames source.s3_key_raw -> s3_key_original and source.s3_key_normalized
// -> s3_key_raw_md (s3KeyRaw held the original for binary kinds but a
// transformed blob for text kinds; the rename makes both columns mean the
// same thing for every kind), and adds source.original_filename.
// drizzle-kit push is avoided because a bare column rename would prompt
// "rename or drop+create?" and hang in non-TTY — a drop+create here would
// lose every existing source's S3 pointer. This script is deterministic and
// safe to re-run. Requires POSTGRES_URL (same as db:push). Run this BEFORE
// updating schema.ts to the new names, then `pnpm db:push` to add the
// remaining new (purely additive) columns.
import { sql } from "drizzle-orm";

import { db } from "../client";

// Identifiers are inlined via sql.raw (validated below) rather than bound as
// parameters: the neon-http driver can't bind parameters inside a DO $$ block
// ("bind message supplies N parameters, but prepared statement requires 0").
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

async function renameColumnIfPresent(
  table: string,
  from: string,
  to: string,
): Promise<void> {
  for (const ident of [table, from, to]) {
    if (!IDENTIFIER.test(ident)) {
      throw new Error(`unsafe identifier: ${ident}`);
    }
  }
  await db.execute(
    sql.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '${table}' AND column_name = '${from}'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '${table}' AND column_name = '${to}'
      ) THEN
        EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', '${table}', '${from}', '${to}');
      END IF;
    END $$;
  `),
  );
}

async function main() {
  await renameColumnIfPresent("source", "s3_key_raw", "s3_key_original");
  await renameColumnIfPresent("source", "s3_key_normalized", "s3_key_raw_md");

  await db.execute(sql`
    ALTER TABLE "source" ADD COLUMN IF NOT EXISTS "original_filename" text
  `);

  console.log("source storage columns migrated.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
