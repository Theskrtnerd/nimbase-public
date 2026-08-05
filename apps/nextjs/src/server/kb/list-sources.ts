import "server-only";

import type { AccessContext } from "@acme/api/access";
import { targetFolderReadFilter } from "@acme/api/access";
import { providerAccessFilter } from "@acme/api/provider-access";
import { and, eq, isNull, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { Source, WikiNode } from "@acme/db/schema";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@acme/validators/cli";

import { paginate } from "~/server/http/paginate";

// Mirror of sourcesRouter.list: sources visible to the caller's read scopes,
// newest first, one page at a time. Shared by the REST route (CLI
// `memory captures list`) and the MCP token paths.
//
// The row shape is inferred from the select rather than restated as an
// interface, so the two cannot drift; `sourceSummarySchema` in @acme/validators
// is the wire contract this must satisfy.

export async function listSourcesForAccess(
  access: AccessContext,
  options: { limit?: number; cursor?: string } = {},
) {
  const { targetPath, scopeFilter } = targetFolderReadFilter(access);

  const { rows, nextCursor } = await paginate(
    {
      createdAt: Source.createdAt,
      id: Source.id,
      limit: options.limit,
      cursor: options.cursor,
      defaultLimit: DEFAULT_PAGE_LIMIT,
      maxLimit: MAX_PAGE_LIMIT,
    },
    ({ limit, keyset, orderBy }) =>
      db
        .select({
          id: Source.id,
          kind: Source.kind,
          sourceUrl: Source.sourceUrl,
          title: Source.title,
          originalFilename: Source.originalFilename,
          status: Source.status,
          error: Source.error,
          capturedAt: Source.capturedAt,
          createdAt: Source.createdAt,
          compiledAt: Source.compiledAt,
          capturedByName: Source.capturedByName,
          targetPath,
          // Exact timestamp text for the cursor — a driver Date would truncate
          // Postgres's microseconds. See CursorKey.
          cursorAt: sql<string>`${Source.createdAt}::text`,
        })
        .from(Source)
        .leftJoin(
          WikiNode,
          and(
            eq(WikiNode.id, Source.targetFolderId),
            isNull(WikiNode.deletedAt),
          ),
        )
        .where(
          and(
            eq(Source.workspaceId, access.workspaceId),
            scopeFilter,
            providerAccessFilter(
              access,
              Source.accessPolicyId,
              Source.accessResourceId,
            ),
            keyset,
          ),
        )
        .orderBy(...orderBy)
        .limit(limit),
  );

  return { sources: rows, nextCursor };
}
