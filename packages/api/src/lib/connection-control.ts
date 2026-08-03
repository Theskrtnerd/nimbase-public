import type {
  SourceConnectionConfig,
  SourceConnectionProvider,
  SourceConnectionStatus,
} from "@acme/db/schema";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { SourceConnection, WikiNode } from "@acme/db/schema";

import type { AccessContext } from "./access";

export type ConnectionControlErrorCode = "not_found" | "invalid_request";

export class ConnectionControlError extends Error {
  constructor(
    readonly code: ConnectionControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectionControlError";
  }
}

export interface ConnectionSummary {
  id: string;
  provider: SourceConnectionProvider;
  displayName: string | null;
  status: SourceConnectionStatus;
  targetFolderId: string | null;
  folderPath: string | null;
  config: SourceConnectionConfig | null;
  intervalSeconds: number;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextRunAt: Date | null;
  createdAt: Date;
}

const publicColumns = {
  id: SourceConnection.id,
  provider: SourceConnection.provider,
  displayName: SourceConnection.displayName,
  status: SourceConnection.status,
  targetFolderId: SourceConnection.targetFolderId,
  folderPath: WikiNode.path,
  config: SourceConnection.config,
  intervalSeconds: SourceConnection.intervalSeconds,
  lastRunAt: SourceConnection.lastRunAt,
  lastSuccessAt: SourceConnection.lastSuccessAt,
  lastError: SourceConnection.lastError,
  consecutiveFailures: SourceConnection.consecutiveFailures,
  nextRunAt: SourceConnection.nextRunAt,
  createdAt: SourceConnection.createdAt,
} as const;

export async function listConnectionsForAccess(
  access: AccessContext,
): Promise<ConnectionSummary[]> {
  const rows = await db
    .select(publicColumns)
    .from(SourceConnection)
    .leftJoin(
      WikiNode,
      and(
        eq(WikiNode.id, SourceConnection.targetFolderId),
        isNull(WikiNode.deletedAt),
      ),
    )
    .where(eq(SourceConnection.workspaceId, access.workspaceId));
  return rows.filter((row) => access.canRead(row.folderPath ?? ""));
}

export async function getConnectionForAccess(
  access: AccessContext,
  connectionId: string,
): Promise<ConnectionSummary> {
  const [row] = await db
    .select(publicColumns)
    .from(SourceConnection)
    .leftJoin(
      WikiNode,
      and(
        eq(WikiNode.id, SourceConnection.targetFolderId),
        isNull(WikiNode.deletedAt),
      ),
    )
    .where(
      and(
        eq(SourceConnection.id, connectionId),
        eq(SourceConnection.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!row || !access.canRead(row.folderPath ?? "")) {
    throw new ConnectionControlError("not_found", "Connection not found");
  }
  return row;
}

export async function requireManageableConnection(
  access: AccessContext,
  connectionId: string,
): Promise<typeof SourceConnection.$inferSelect & { path: string }> {
  const [row] = await db
    .select({
      connection: SourceConnection,
      folderPath: WikiNode.path,
    })
    .from(SourceConnection)
    .leftJoin(
      WikiNode,
      and(
        eq(WikiNode.id, SourceConnection.targetFolderId),
        isNull(WikiNode.deletedAt),
      ),
    )
    .where(
      and(
        eq(SourceConnection.id, connectionId),
        eq(SourceConnection.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!row || !access.canManage(row.folderPath ?? "")) {
    throw new ConnectionControlError("not_found", "Connection not found");
  }
  return {
    ...row.connection,
    path: row.folderPath ?? "",
  };
}

export async function requireSyncableConnection(
  access: AccessContext,
  connectionId: string,
): Promise<void> {
  const connection = await requireManageableConnection(access, connectionId);
  if (connection.status !== "active") {
    throw new ConnectionControlError(
      "invalid_request",
      `Connection is ${connection.status}; resume it before synchronizing`,
    );
  }
}

export async function setConnectionPaused(args: {
  access: AccessContext;
  connectionId: string;
  paused: boolean;
}): Promise<void> {
  await requireManageableConnection(args.access, args.connectionId);
  await db
    .update(SourceConnection)
    .set(
      args.paused
        ? { status: "paused", nextRunAt: null }
        : {
            status: "active",
            nextRunAt: new Date(),
            consecutiveFailures: 0,
            lastError: null,
          },
    )
    .where(eq(SourceConnection.id, args.connectionId));
}

export async function updateConnection(args: {
  access: AccessContext;
  connectionId: string;
  displayName?: string;
  intervalSeconds?: number;
  config?: SourceConnectionConfig;
}): Promise<void> {
  await requireManageableConnection(args.access, args.connectionId);
  await db
    .update(SourceConnection)
    .set({
      ...(args.displayName !== undefined
        ? { displayName: args.displayName }
        : {}),
      ...(args.intervalSeconds !== undefined
        ? { intervalSeconds: args.intervalSeconds }
        : {}),
      ...(args.config !== undefined ? { config: args.config } : {}),
    })
    .where(eq(SourceConnection.id, args.connectionId));
}

export async function applyConnectionScopeConfiguration(
  connection: Awaited<ReturnType<typeof requireManageableConnection>>,
  scopeIds: string[],
): Promise<void> {
  const config: SourceConnectionConfig = {
    ...connection.config,
    scopeIds: [...new Set(scopeIds)],
  };
  await db
    .update(SourceConnection)
    .set({
      config,
      cursor: null,
      status: "active",
      nextRunAt: new Date(),
      lastError: null,
      consecutiveFailures: 0,
    })
    .where(eq(SourceConnection.id, connection.id));
}

export async function deleteConnection(
  access: AccessContext,
  connectionId: string,
): Promise<void> {
  await requireManageableConnection(access, connectionId);
  await db
    .delete(SourceConnection)
    .where(eq(SourceConnection.id, connectionId));
}
