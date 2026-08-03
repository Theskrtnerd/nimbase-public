import type { TRPCRouterRecord } from "@trpc/server";

import { and, desc, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { Source, WikiNode } from "@acme/db/schema";

import { targetFolderReadFilter } from "../lib/access";
import { providerAccessFilter } from "../lib/provider-access";
import { workspaceProcedure } from "../trpc";

// Newest sources, capped. No pagination yet (YAGNI) — bump or paginate when
// real workspaces exceed this.
const MAX_SOURCES = 100;

export const sourcesRouter = {
  // A source is visible iff its target space is readable (targetFolderReadFilter).
  list: workspaceProcedure.query(async ({ ctx, input }) => {
    const { targetPath, scopeFilter } = targetFolderReadFilter(ctx.access);
    return db
      .select({
        id: Source.id,
        kind: Source.kind,
        sourceUrl: Source.sourceUrl,
        title: Source.title,
        originalFilename: Source.originalFilename,
        status: Source.status,
        error: Source.error,
        compileReport: Source.compileReport,
        metadata: Source.metadata,
        capturedAt: Source.capturedAt,
        createdAt: Source.createdAt,
        compiledAt: Source.compiledAt,
        capturedByName: Source.capturedByName,
        targetPath,
      })
      .from(Source)
      .leftJoin(
        WikiNode,
        and(eq(WikiNode.id, Source.targetFolderId), isNull(WikiNode.deletedAt)),
      )
      .where(
        and(
          eq(Source.workspaceId, input.workspaceId),
          scopeFilter,
          providerAccessFilter(ctx.access, Source.accessPolicyId),
        ),
      )
      .orderBy(desc(Source.createdAt))
      .limit(MAX_SOURCES);
  }),
} satisfies TRPCRouterRecord;
