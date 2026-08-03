// One-off migration repairing artifact-table schema drift:
//   pnpm -F @acme/db migrate:artifact-anchor       (dev)
//   pnpm -F @acme/db migrate:artifact-anchor:prod  (prod)
// Two schema changes were committed but never pushed to the databases:
//   - 81ae590 added Artifact.targetFolderId (folder anchor)  -> add target_folder_id
//   - 01f85c1 dropped Artifact.nodeIds                        -> drop orphan node_ids
// drizzle-kit push is avoided because it would prompt "rename node_ids ->
// target_folder_id?" and hang in non-TTY. This script is deterministic and
// safe to re-run. Requires POSTGRES_URL (same as db:push).
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  // Add target_folder_id + its FK idempotently, naming the constraint exactly
  // as drizzle-kit would (<table>_<col>_<reftable>_<refcol>_fk) so a future
  // push sees it as already present instead of trying to recreate it.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'artifact' AND column_name = 'target_folder_id'
      ) THEN
        ALTER TABLE "artifact" ADD COLUMN "target_folder_id" uuid;
        ALTER TABLE "artifact"
          ADD CONSTRAINT "artifact_target_folder_id_wiki_node_id_fk"
          FOREIGN KEY ("target_folder_id")
          REFERENCES "wiki_node"("id") ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // Drop the orphan node_ids column left over from the artifact refactor. Its
  // NOT NULL constraint would fail every insert now that the code no longer
  // supplies it.
  await db.execute(
    sql`ALTER TABLE "artifact" DROP COLUMN IF EXISTS "node_ids"`,
  );

  console.log("artifact: target_folder_id ensured, orphan node_ids dropped.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
