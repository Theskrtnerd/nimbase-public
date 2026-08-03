// One-off additive migration adding the wiki_node.title column:
//   pnpm -F @acme/db migrate:node-title       (dev)
//   pnpm -F @acme/db migrate:node-title:prod  (prod)
// drizzle-kit push is avoided because it hangs in non-TTY. This script is
// deterministic and safe to re-run. Requires POSTGRES_URL (same as db:push).
// Purely additive — nullable, no default; existing rows read as null (fall
// back to a path-derived title) until they recompile.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    ALTER TABLE "wiki_node" ADD COLUMN IF NOT EXISTS "title" text;
  `);

  console.log("wiki_node.title column ensured.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
