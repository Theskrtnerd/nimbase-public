// One-off additive migration for the god-mode operator audit log:
//   pnpm -F @acme/db migrate:operator-audit
// Creates operator_audit_log (idempotent). Requires POSTGRES_URL (same as
// db:push). Additive only — drizzle-kit push is avoided because it prompts
// interactively; this script is deterministic and safe to re-run.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "operator_audit_log" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "operator_user_id" text NOT NULL,
      "workspace_id" uuid NOT NULL,
      "action" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "operator_audit_log_workspace_idx"
      ON "operator_audit_log" ("workspace_id")
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "operator_audit_log_operator_idx"
      ON "operator_audit_log" ("operator_user_id")
  `);

  console.log("operator_audit_log ready.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
