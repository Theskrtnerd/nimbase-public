import { randomBytes, randomUUID } from "node:crypto";

import type {
  ConnectionPlatform,
  ConnectionStatus,
  WidgetInterfaceConfig,
} from "@acme/db/schema";
import { and, eq, inArray, isNull, like, ne, or } from "@acme/db";
import { db } from "@acme/db/client";
import { AccessGrant, Agent, AgentConnection, WikiNode } from "@acme/db/schema";
import {
  isReservedSlug,
  nextAvailableSlug,
  resourceSlugBase,
} from "@acme/db/slug";

import type { AccessContext } from "./access";
import { targetFolderReadFilter } from "./access";
import { assertWithinLimit } from "./entitlements";
import { anchorFolderPath } from "./folders";

export type DeploymentControlErrorCode =
  | "conflict"
  | "forbidden"
  | "invalid"
  | "not_found";

export class DeploymentControlError extends Error {
  constructor(
    readonly code: DeploymentControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentControlError";
  }
}

export interface DeploymentTarget {
  platform: ConnectionPlatform;
  status: ConnectionStatus;
  name: string | null;
  error: string | null;
  // Publishable widget route key used only by the HTTP adapter to build the
  // embed snippet. Private adapter route keys are never exposed here.
  widgetPublicKey: string | null;
}

export interface DeploymentSummary {
  slug: string;
  name: string;
  enabled: boolean;
  targetPath: string;
  targets: DeploymentTarget[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DeploymentDetail extends DeploymentSummary {
  instructions: string;
  targetFolderId: string | null;
}

interface DeploymentRecord extends DeploymentDetail {
  id: string;
  workspaceId: string;
}

const deploymentColumns = {
  id: Agent.id,
  workspaceId: Agent.workspaceId,
  slug: Agent.slug,
  name: Agent.name,
  instructions: Agent.instructions,
  targetFolderId: Agent.targetFolderId,
  enabled: Agent.enabled,
  targetPath: WikiNode.path,
  createdAt: Agent.createdAt,
  updatedAt: Agent.updatedAt,
} as const;

export async function listDeploymentsForAccess(
  access: AccessContext,
): Promise<DeploymentSummary[]> {
  const { targetPath, scopeFilter } = targetFolderReadFilter(access);
  const rows = await db
    .select({
      ...deploymentColumns,
      targetPath,
      resolvedFolderId: WikiNode.id,
    })
    .from(Agent)
    .leftJoin(
      WikiNode,
      and(eq(WikiNode.id, Agent.targetFolderId), isNull(WikiNode.deletedAt)),
    )
    .where(and(eq(Agent.workspaceId, access.workspaceId), scopeFilter))
    .orderBy(Agent.slug);
  const visibleRows = rows.filter(
    (row) => row.targetFolderId === null || row.resolvedFolderId !== null,
  );
  const targets = await loadTargets(visibleRows.map((row) => row.id));
  return visibleRows.map((row) => ({
    slug: row.slug,
    name: row.name,
    enabled: row.enabled,
    targetPath: row.targetPath,
    targets: targets.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getDeploymentForAccess(
  access: AccessContext,
  slug: string,
): Promise<DeploymentDetail> {
  const record = await loadDeployment(access, slug, "read");
  return publicDetail(record);
}

export async function createDeployment(args: {
  access: AccessContext;
  userId: string;
  slug?: string;
  name: string;
  instructions?: string;
  targetFolderId?: string | null;
  interface?: {
    platform: "widget";
    config: WidgetInterfaceConfig;
  };
}): Promise<DeploymentDetail & { id: string }> {
  const folderId = args.targetFolderId ?? null;
  const path = await anchorFolderPath(args.access.workspaceId, folderId);
  if (path === null) {
    throw new DeploymentControlError("not_found", "Anchor folder not found");
  }
  if (!args.access.canManage(path)) {
    throw new DeploymentControlError(
      "forbidden",
      "Manager access over the anchor folder required",
    );
  }
  if (args.interface) {
    await assertWithinLimit(args.access.workspaceId, "widgets");
  }

  const slugBase = args.slug ?? resourceSlugBase(args.name, "agent");
  if (args.slug && isReservedSlug(args.slug)) {
    throw new DeploymentControlError(
      "invalid",
      `The slug "${args.slug}" is reserved`,
    );
  }
  const takenRows = await db
    .select({ slug: Agent.slug })
    .from(Agent)
    .where(
      and(
        eq(Agent.workspaceId, args.access.workspaceId),
        or(eq(Agent.slug, slugBase), like(Agent.slug, `${slugBase}-%`)),
      ),
    )
    .limit(200);
  const taken = new Set(takenRows.map((row) => row.slug));
  if (args.slug && taken.has(args.slug)) {
    throw new DeploymentControlError(
      "conflict",
      `The slug "${args.slug}" is already in use`,
    );
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomUUID();
    const slug = nextAvailableSlug(slugBase, taken);
    try {
      const agentInsert = db.insert(Agent).values({
        id,
        workspaceId: args.access.workspaceId,
        slug,
        name: args.name,
        instructions: args.instructions ?? "",
        targetFolderId: folderId,
        createdByUserId: args.userId,
      });
      const grantInsert = db.insert(AccessGrant).values({
        workspaceId: args.access.workspaceId,
        principalType: "agent",
        principalId: id,
        folderId,
        role: "viewer",
        createdByUserId: args.userId,
      });
      let targets: DeploymentTarget[] = [];
      if (args.interface) {
        const publicKey = newWidgetPublicKey();
        await db.batch([
          agentInsert,
          grantInsert,
          db.insert(AgentConnection).values({
            agentId: id,
            workspaceId: args.access.workspaceId,
            platform: "widget",
            routeKey: publicKey,
            interfaceConfig: args.interface.config,
            status: "active",
            createdByUserId: args.userId,
          }),
        ]);
        targets = [
          {
            platform: "widget",
            status: "active",
            name: null,
            error: null,
            widgetPublicKey: publicKey,
          },
        ];
      } else {
        await db.batch([agentInsert, grantInsert]);
      }
      const now = new Date();
      return {
        id,
        slug,
        name: args.name,
        instructions: args.instructions ?? "",
        targetFolderId: folderId,
        enabled: true,
        targetPath: path,
        targets,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      if (args.slug) {
        throw new DeploymentControlError(
          "conflict",
          `The slug "${args.slug}" is already in use`,
        );
      }
      taken.add(slug);
    }
  }

  throw new Error("Failed to allocate a deployment slug");
}

export async function deleteDeployment(args: {
  access: AccessContext;
  slug: string;
}): Promise<void> {
  const record = await loadDeployment(args.access, args.slug, "manage");
  await db.batch([
    db.delete(Agent).where(eq(Agent.id, record.id)),
    db
      .delete(AccessGrant)
      .where(
        and(
          eq(AccessGrant.workspaceId, record.workspaceId),
          eq(AccessGrant.principalType, "agent"),
          eq(AccessGrant.principalId, record.id),
        ),
      ),
  ]);
}

async function loadDeployment(
  access: AccessContext,
  slug: string,
  permission: "read" | "manage",
): Promise<DeploymentRecord> {
  const [row] = await db
    .select(deploymentColumns)
    .from(Agent)
    .leftJoin(
      WikiNode,
      and(eq(WikiNode.id, Agent.targetFolderId), isNull(WikiNode.deletedAt)),
    )
    .where(
      and(
        eq(Agent.workspaceId, access.workspaceId),
        eq(Agent.slug, slug.toLowerCase()),
      ),
    )
    .limit(1);
  const anchorExists =
    row && (row.targetFolderId === null || row.targetPath !== null);
  const path = row?.targetPath ?? "";
  const allowed =
    permission === "manage" ? access.canManage(path) : access.canRead(path);
  if (!row || !anchorExists || !allowed) {
    throw new DeploymentControlError(
      "not_found",
      `Deployment "${slug}" not found`,
    );
  }
  const targets = await loadTargets([row.id]);
  return {
    ...row,
    targetPath: path,
    targets: targets.get(row.id) ?? [],
  };
}

async function loadTargets(
  agentIds: string[],
): Promise<Map<string, DeploymentTarget[]>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db
    .select({
      agentId: AgentConnection.agentId,
      platform: AgentConnection.platform,
      status: AgentConnection.status,
      routeKey: AgentConnection.routeKey,
      externalMeta: AgentConnection.externalMeta,
      error: AgentConnection.error,
    })
    .from(AgentConnection)
    .where(
      and(
        inArray(AgentConnection.agentId, agentIds),
        ne(AgentConnection.status, "revoked"),
      ),
    )
    .orderBy(AgentConnection.platform);
  const byAgent = new Map<string, DeploymentTarget[]>();
  for (const row of rows) {
    const targets = byAgent.get(row.agentId) ?? [];
    targets.push({
      platform: row.platform,
      status: row.status,
      name: row.externalMeta?.teamName ?? null,
      error: row.error,
      widgetPublicKey: row.platform === "widget" ? row.routeKey : null,
    });
    byAgent.set(row.agentId, targets);
  }
  return byAgent;
}

function newWidgetPublicKey(): string {
  return `nb_wgt_${randomBytes(16).toString("hex")}`;
}

function publicDetail(record: DeploymentRecord): DeploymentDetail {
  return {
    slug: record.slug,
    name: record.name,
    instructions: record.instructions,
    targetFolderId: record.targetFolderId,
    enabled: record.enabled,
    targetPath: record.targetPath,
    targets: record.targets,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
