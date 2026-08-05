import "server-only";

import type { MemoryMutationChange } from "@acme/db/schema";
import { and, asc, eq, inArray, isNull, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  MemoryGitRef,
  MemoryMutation,
  memoryMutationChangesSchema,
  WikiNodeVersion,
} from "@acme/db/schema";

import type { LooseGitObject } from "./git-object";
import * as s3 from "../s3";
import { createGitCommit, createGitTrees } from "./git-object";
import { applyMemoryChanges } from "./git-projection";

const MAX_CAS_ATTEMPTS = 8;

async function loadVersionBodies(
  changes: MemoryMutationChange[],
): Promise<Map<string, string>> {
  const versionIds = [
    ...new Set(
      changes.flatMap((change) =>
        change.type === "upsert" ? [change.versionId] : [],
      ),
    ),
  ];
  const versions =
    versionIds.length === 0
      ? []
      : await db
          .select({ id: WikiNodeVersion.id, s3Key: WikiNodeVersion.s3Key })
          .from(WikiNodeVersion)
          .where(inArray(WikiNodeVersion.id, versionIds));
  const keys = new Map(versions.map((version) => [version.id, version.s3Key]));
  const bodies = await Promise.all(
    versionIds.map(async (versionId) => {
      const key = keys.get(versionId);
      if (!key) throw new Error(`memory version ${versionId} does not exist`);
      return [versionId, await s3.getObjectText(key)] as const;
    }),
  );
  return new Map(bodies);
}

async function storeObjects(
  workspaceId: string,
  objects: LooseGitObject[],
): Promise<void> {
  await Promise.all(
    objects.map((object) =>
      s3.putObject(
        s3.s3KeyFor.memoryGitObject(workspaceId, object.oid),
        object.compressed,
        "application/x-git-loose-object",
      ),
    ),
  );
}

async function projectMutation(
  workspaceId: string,
  mutation: typeof MemoryMutation.$inferSelect,
): Promise<void> {
  const changes = memoryMutationChangesSchema.parse(mutation.changes);
  const [, versionBodies] = await Promise.all([
    db
      .insert(MemoryGitRef)
      .values({ workspaceId })
      .onConflictDoNothing({ target: MemoryGitRef.workspaceId }),
    loadVersionBodies(changes),
  ]);
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const [ref] = await db
      .select()
      .from(MemoryGitRef)
      .where(eq(MemoryGitRef.workspaceId, workspaceId))
      .limit(1);
    if (!ref) throw new Error("failed to initialize memory Git ref");

    const { entries, blobs } = applyMemoryChanges(
      ref.entries,
      changes,
      versionBodies,
    );
    const trees = createGitTrees(entries);
    const commit = createGitCommit({
      treeOid: trees.rootOid,
      parentOid: ref.headSha,
      message: mutation.message,
      createdAt: mutation.createdAt,
    });
    await storeObjects(workspaceId, [...blobs, ...trees.objects, commit]);

    await db.execute(sql`
      WITH advanced AS (
        UPDATE "memory_git_ref"
        SET "head_sha" = ${commit.oid},
            "entries" = ${JSON.stringify(entries)}::jsonb,
            "revision" = "revision" + 1,
            "updated_at" = now()
        WHERE "workspace_id" = ${workspaceId}
          AND "revision" = ${ref.revision}
          AND "head_sha" IS NOT DISTINCT FROM ${ref.headSha}
        RETURNING "workspace_id"
      )
      UPDATE "memory_mutation"
      SET "git_commit_sha" = ${commit.oid},
          "projected_at" = now(),
          "projection_attempts" = "projection_attempts" + 1,
          "projection_error" = NULL
      WHERE "id" = ${mutation.id}
        AND EXISTS (SELECT 1 FROM advanced)
    `);
    const [projected] = await db
      .select({ projectedAt: MemoryMutation.projectedAt })
      .from(MemoryMutation)
      .where(eq(MemoryMutation.id, mutation.id))
      .limit(1);
    if (projected?.projectedAt) return;
  }
  throw new Error("memory Git ref stayed busy during projection");
}

export async function projectPendingMemoryHistory(
  workspaceId: string,
): Promise<number> {
  let projected = 0;
  while (true) {
    const [mutation] = await db
      .select()
      .from(MemoryMutation)
      .where(
        and(
          eq(MemoryMutation.workspaceId, workspaceId),
          isNull(MemoryMutation.projectedAt),
        ),
      )
      .orderBy(asc(MemoryMutation.sequence))
      .limit(1);
    if (!mutation) return projected;
    try {
      await projectMutation(workspaceId, mutation);
      projected += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(MemoryMutation)
        .set({
          projectionAttempts: sql`${MemoryMutation.projectionAttempts} + 1`,
          projectionError: message.slice(0, 2_000),
        })
        .where(eq(MemoryMutation.id, mutation.id));
      throw error;
    }
  }
}
