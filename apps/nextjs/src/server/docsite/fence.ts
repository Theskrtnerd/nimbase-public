import "server-only";

import type { PathScope } from "@acme/db";
import { anchoredScopes, loadRestrictedPaths } from "@acme/api/access";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode } from "@acme/db/schema";

export interface DocSiteFence {
  /** Read scopes for the build — what memory the site may contain. */
  scopes: PathScope[];
  /**
   * The deployment folder path, stripped from every projected page path.
   */
  prefix: string;
}

/**
 * The read fence for a docs-site build.
 *
 * Derived here, at build time, from the site's folder anchor — never taken
 * from the job payload. A docs site is published to people outside the company,
 * so this is the single boundary deciding what leaves the building: whoever
 * triggers a rebuild, and whatever scopes they personally hold, the site
 * contains exactly that folder and nothing else.
 *
 * A null folder id deliberately selects the centralized KB root. A configured
 * folder that is missing or soft-deleted fails closed rather than widening to
 * root. A build that projects zero pages is a visible, recoverable failure.
 */
export async function resolveDocSiteFence(
  workspaceId: string,
  folderId: string | null,
): Promise<DocSiteFence> {
  const row = folderId
    ? (
        await db
          .select({ folderPath: WikiNode.path })
          .from(WikiNode)
          .where(
            and(
              eq(WikiNode.id, folderId),
              eq(WikiNode.workspaceId, workspaceId),
              isNull(WikiNode.deletedAt),
            ),
          )
          .limit(1)
      )[0]
    : { folderPath: "" };

  const restricted = await loadRestrictedPaths(workspaceId);
  return {
    scopes: anchoredScopes(row?.folderPath ?? null, restricted, "viewer"),
    prefix: row?.folderPath ?? "",
  };
}
