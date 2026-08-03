// Collapse artifact visibility to private | public:
//   pnpm -F @acme/db migrate:artifact-visibility       (dev)
//   pnpm -F @acme/db migrate:artifact-visibility:prod  (prod)
//
// Legacy password-protected artifacts fail closed to private before their
// password hashes are removed. Constraints keep every artifact-producing
// surface on the same two-state model. Safe to re-run.
import { sql } from "drizzle-orm";

import { db } from "../client";

async function main() {
  await db.execute(
    sql.raw(`
      DO $artifact_visibility_migration$
      BEGIN
        UPDATE "artifact"
        SET "visibility" = 'private'
        WHERE "visibility" NOT IN ('private', 'public');

        UPDATE "agent"
        SET "artifact_visibility" = 'private'
        WHERE "artifact_visibility" NOT IN ('private', 'public');

        UPDATE "group_mcp"
        SET "artifact_visibility" = 'private'
        WHERE "artifact_visibility" NOT IN ('private', 'public');

        ALTER TABLE "artifact" DROP COLUMN IF EXISTS "password_hash";

        ALTER TABLE "artifact"
          DROP CONSTRAINT IF EXISTS "artifact_visibility_check",
          ADD CONSTRAINT "artifact_visibility_check"
          CHECK ("visibility" IN ('private', 'public'));

        ALTER TABLE "agent"
          DROP CONSTRAINT IF EXISTS "agent_artifact_visibility_check",
          ADD CONSTRAINT "agent_artifact_visibility_check"
          CHECK ("artifact_visibility" IN ('private', 'public'));

        ALTER TABLE "group_mcp"
          DROP CONSTRAINT IF EXISTS "group_mcp_artifact_visibility_check",
          ADD CONSTRAINT "group_mcp_artifact_visibility_check"
          CHECK ("artifact_visibility" IN ('private', 'public'));
      END;
      $artifact_visibility_migration$
    `),
  );
  console.log("artifact visibility reduced to private | public");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
