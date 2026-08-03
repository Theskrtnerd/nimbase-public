import "server-only";

import type { AccessContext } from "@acme/api/access";
import { targetFolderReadFilter } from "@acme/api/access";
import { and, eq, isNull, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact, WikiNode } from "@acme/db/schema";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@acme/validators/cli";

import { paginate } from "~/server/http/paginate";

// Mirror of artifactRouter.list: artifacts visible to the caller's read scopes,
// one page at a time. Shared by the REST route (CLI `deploy artifact list`) so
// the ApiToken/session-token credential paths get the same visibility rule as
// the dashboard's cookie path.
//
// Ordered by createdAt where the router uses updatedAt: the cursor keys off the
// sort column, and updatedAt changes when an artifact regenerates, which would
// let a row cross a page boundary mid-pagination.

export async function listArtifactsForAccess(
  access: AccessContext,
  options: { limit?: number; cursor?: string } = {},
) {
  const { targetPath, scopeFilter } = targetFolderReadFilter(access);

  const { rows, nextCursor } = await paginate(
    {
      createdAt: Artifact.createdAt,
      id: Artifact.id,
      limit: options.limit,
      cursor: options.cursor,
      defaultLimit: DEFAULT_PAGE_LIMIT,
      maxLimit: MAX_PAGE_LIMIT,
    },
    ({ limit, keyset, orderBy }) =>
      db
        .select({
          id: Artifact.id,
          title: Artifact.title,
          kind: Artifact.kind,
          status: Artifact.status,
          visibility: Artifact.visibility,
          slug: Artifact.slug,
          error: Artifact.error,
          prompt: Artifact.prompt,
          targetPath,
          createdAt: Artifact.createdAt,
          updatedAt: Artifact.updatedAt,
          cursorAt: sql<string>`${Artifact.createdAt}::text`,
        })
        .from(Artifact)
        .leftJoin(
          WikiNode,
          and(
            eq(WikiNode.id, Artifact.targetFolderId),
            isNull(WikiNode.deletedAt),
          ),
        )
        .where(
          and(
            eq(Artifact.workspaceId, access.workspaceId),
            scopeFilter,
            keyset,
          ),
        )
        .orderBy(...orderBy)
        .limit(limit),
  );

  return { artifacts: rows, nextCursor };
}
