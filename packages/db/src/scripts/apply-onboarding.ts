// Additive migration for workspace onboarding:
//   pnpm -F @acme/db migrate:onboarding       (dev)
//   pnpm -F @acme/db migrate:onboarding:prod  (prod)
// Adds workspace.website and workspace.brain_init_status (default "pending").
// Existing workspaces predate brain-init tracking; flip them to "done" to avoid misleading "drafting…" state. Requires POSTGRES_URL.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "website" text
  `);
  await db.execute(sql`
    ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "brain_init_status" text NOT NULL DEFAULT 'pending'
  `);
  // Flip all pre-existing pending workspaces to "done" — at migration time,
  // only "pending" (fresh from ADD COLUMN default) exist; this is idempotent.
  await db.execute(sql`
    UPDATE "workspace" SET "brain_init_status" = 'done'
    WHERE "brain_init_status" = 'pending'
  `);
  console.log("[migrate:onboarding] applied");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
