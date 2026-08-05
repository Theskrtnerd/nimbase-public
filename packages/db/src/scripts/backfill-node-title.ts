// One-off migration: backfill WikiNode.title for rows that predate the
// title feature (all rows today — Phase 3 shipped title as nullable first),
// then make the column NOT NULL.
//   pnpm -F @acme/db migrate:backfill-node-title       (dev)
//   pnpm -F @acme/db migrate:backfill-node-title:prod  (prod)
// drizzle-kit push is avoided because it hangs in non-TTY. Safe to re-run:
// the backfill only touches still-null rows, and SET NOT NULL is a no-op
// once every row has a value.
//
// The derivation below is a one-time migration convenience, not app logic —
// the running app no longer derives titles from paths anywhere (every note
// requires a real title at creation; see @acme/runtime/memory/wiki vfs.ts). This backfill just
// gives legacy rows (including permission-anchor "folder" rows, which the
// NOT NULL constraint also covers even though nothing displays their title)
// a reasonable starting value instead of leaving them null.
import { eq, isNull, sql } from "drizzle-orm";

import { db } from "../client";
import { WikiNode } from "../schema";

function titleFromPathOnce(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? path;
  const spaced = last.replace(/[-_]/g, " ").trim();
  if (spaced.length === 0) return path;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

async function main() {
  const rows = await db
    .select({ id: WikiNode.id, path: WikiNode.path })
    .from(WikiNode)
    .where(isNull(WikiNode.title));

  console.log(`backfilling ${String(rows.length)} row(s)...`);
  for (const row of rows) {
    await db
      .update(WikiNode)
      .set({ title: titleFromPathOnce(row.path) })
      .where(eq(WikiNode.id, row.id));
  }

  await db.execute(sql`
    ALTER TABLE "wiki_node" ALTER COLUMN "title" SET NOT NULL;
  `);

  console.log("wiki_node.title backfilled and set NOT NULL.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
