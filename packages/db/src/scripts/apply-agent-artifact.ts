// Additive migration for agent artifact authoring:
//   pnpm -F @acme/db migrate:agent-artifact       (dev)
//   pnpm -F @acme/db migrate:agent-artifact:prod  (prod)
// Adds agent.artifact_enabled + agent.artifact_visibility. Both default to the
// closed position (off / private), so existing agents are unchanged by this
// migration — enabling artifact is a deliberate per-agent act. Mirrors
// apply-widget.ts: everything is IF NOT EXISTS / idempotent and safe to re-run.
// Requires POSTGRES_URL.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    ALTER TABLE "agent"
      ADD COLUMN IF NOT EXISTS "artifact_enabled" boolean NOT NULL DEFAULT false;
  `);
  await db.execute(sql`
    ALTER TABLE "agent"
      ADD COLUMN IF NOT EXISTS "artifact_visibility" text NOT NULL DEFAULT 'private';
  `);
  console.log("agent artifact migration applied");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
