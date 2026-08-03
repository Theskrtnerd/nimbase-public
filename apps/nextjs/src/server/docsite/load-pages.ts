import "server-only";

import type { MemoryPage } from "@acme/cloud/docs/project";
import type { PathScope } from "@acme/db";
import { pathScopeWhere } from "@acme/api/access";
import { getObjectText } from "@acme/cloud/s3";
import { and, eq, isNull, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode, WikiNodeVersion } from "@acme/db/schema";

/**
 * Cap on pages per build. A docs site is a static Astro build; past a few
 * thousand pages the build stops being a background job and starts being an
 * outage. Hitting the cap truncates *and says so* — a silently short site
 * reads as "that's all the memory there is", which is the wrong conclusion.
 */
export const MAX_DOC_PAGES = 2000;

/** Bodies are read from S3; this bounds concurrent object reads per build. */
const READ_CONCURRENCY = 16;

export interface LoadedPages {
  pages: MemoryPage[];
  /** True when MAX_DOC_PAGES clipped the result. */
  truncated: boolean;
  /** Nodes whose body could not be read; excluded rather than half-rendered. */
  unreadable: string[];
}

/**
 * Every compiled memory note inside the fence, with its body.
 *
 * The scope filter is applied in SQL via the shared `pathScopeWhere`, so this
 * read surface enforces the fence exactly the way tree/search/graph do — an
 * empty scope list becomes `false` and returns nothing, which is the fail-closed
 * behavior `resolveDocSiteFence` depends on.
 */
export async function loadFencedPages(
  workspaceId: string,
  scopes: PathScope[],
): Promise<LoadedPages> {
  const rows = await db
    .select({
      path: WikiNode.path,
      title: WikiNode.title,
      s3Key: WikiNodeVersion.s3Key,
    })
    .from(WikiNode)
    .innerJoin(
      WikiNodeVersion,
      eq(WikiNodeVersion.id, WikiNode.currentVersionId),
    )
    .where(
      and(
        eq(WikiNode.workspaceId, workspaceId),
        isNull(WikiNode.deletedAt),
        // Folder rows carry no body; only notes and datasets become pages.
        sql`${WikiNode.kind} in ('note', 'dataset')`,
        pathScopeWhere(WikiNode.path, scopes),
      ),
    )
    // Deterministic order in, deterministic build out.
    .orderBy(WikiNode.path)
    .limit(MAX_DOC_PAGES + 1);

  const truncated = rows.length > MAX_DOC_PAGES;
  const capped = truncated ? rows.slice(0, MAX_DOC_PAGES) : rows;

  const pages: MemoryPage[] = [];
  const unreadable: string[] = [];
  for (let i = 0; i < capped.length; i += READ_CONCURRENCY) {
    const batch = capped.slice(i, i + READ_CONCURRENCY);
    const bodies = await Promise.all(
      batch.map(async (row) => {
        try {
          return await getObjectText(row.s3Key);
        } catch {
          // One missing object must not fail a whole site build; the page is
          // dropped and named in the build log.
          return null;
        }
      }),
    );
    batch.forEach((row, j) => {
      const body = bodies[j];
      if (body === null || body === undefined) {
        unreadable.push(row.path);
        return;
      }
      pages.push({ path: row.path, title: row.title, body });
    });
  }

  return { pages, truncated, unreadable };
}
