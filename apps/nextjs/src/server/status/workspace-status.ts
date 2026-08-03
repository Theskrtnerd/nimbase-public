import "server-only";

import type { AccessContext } from "@acme/api/access";
import { pathScopeWhere, targetFolderReadFilter } from "@acme/api/access";
import { listConnectionsForAccess } from "@acme/api/connection-control";
import { resolveEntitlements } from "@acme/api/entitlements";
import { providerAccessFilter } from "@acme/api/provider-access";
import { and, count, eq, isNotNull, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { Source, WikiNode, Workspace } from "@acme/db/schema";

export async function workspaceStatus(access: AccessContext) {
  const memoryScope = pathScopeWhere(WikiNode.path, access.scopes("viewer"));
  const { scopeFilter } = targetFolderReadFilter(access);
  const [workspaceRows, entitlements, memoryRows, sourceRows, connections] =
    await Promise.all([
      db
        .select({
          id: Workspace.id,
          name: Workspace.name,
          slug: Workspace.slug,
          brainInitStatus: Workspace.brainInitStatus,
        })
        .from(Workspace)
        .where(eq(Workspace.id, access.workspaceId))
        .limit(1),
      resolveEntitlements(access.workspaceId),
      db
        .select({ count: count() })
        .from(WikiNode)
        .where(
          and(
            eq(WikiNode.workspaceId, access.workspaceId),
            isNotNull(WikiNode.currentVersionId),
            isNull(WikiNode.deletedAt),
            memoryScope,
          ),
        ),
      db
        .select({ status: Source.status, count: count() })
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
            providerAccessFilter(access, Source.accessPolicyId),
          ),
        )
        .groupBy(Source.status),
      listConnectionsForAccess(access),
    ]);

  const workspace = workspaceRows[0];
  if (!workspace) return null;
  const capturesByStatus = Object.fromEntries(
    sourceRows.map((row) => [row.status, row.count]),
  );
  const connectionsByStatus = Object.fromEntries(
    ["active", "paused", "error", "revoked"].map((status) => [
      status,
      connections.filter((connection) => connection.status === status).length,
    ]),
  );
  const incomplete: typeof connections = [];
  const unhealthy = connections.filter(
    (connection) =>
      connection.status === "error" || connection.consecutiveFailures > 0,
  );

  return {
    workspace,
    plan: {
      id: entitlements.plan,
      status: entitlements.status,
    },
    memory: { compiled: memoryRows[0]?.count ?? 0 },
    captures: {
      total: sourceRows.reduce((total, row) => total + row.count, 0),
      byStatus: capturesByStatus,
    },
    connections: {
      total: connections.length,
      byStatus: connectionsByStatus,
      incomplete: incomplete.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        displayName: connection.displayName,
      })),
      unhealthy: unhealthy.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        displayName: connection.displayName,
        status: connection.status,
        lastError: connection.lastError,
        consecutiveFailures: connection.consecutiveFailures,
      })),
    },
  };
}
