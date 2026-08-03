import type {
  ArtifactVisibility,
  DocSiteVisibility,
  GroupMcpTool,
  McpAuthMethod,
} from "@acme/db/schema";
import { and, desc, eq, like, or, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  DocSite,
  DocSiteBuild,
  GroupMcp,
  WikiNode,
  Workspace,
} from "@acme/db/schema";
import {
  isReservedSlug,
  nextAvailableSlug,
  resourceSlugBase,
} from "@acme/db/slug";

import { assertWithinLimit } from "./entitlements";
import { ensureFolderNode } from "./folders";

export type DeploymentSurfaceErrorCode = "conflict" | "invalid" | "not_found";

export class DeploymentSurfaceError extends Error {
  constructor(
    readonly code: DeploymentSurfaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentSurfaceError";
  }
}

interface CreateGroupMcpInput {
  workspaceId: string;
  slug?: string;
  name: string;
  instructions: string;
  folderPath?: string;
  tools: GroupMcpTool[];
  authMethods?: McpAuthMethod[];
  artifactVisibility?: ArtifactVisibility;
}

interface CreateDocSiteInput {
  workspaceId: string;
  userId: string;
  slug?: string;
  name: string;
  folderPath?: string;
  description?: string;
  instructions?: string;
  visibility?: DocSiteVisibility;
}

type SluggedTable = typeof GroupMcp | typeof DocSite;

async function allocateSlug(
  table: SluggedTable,
  workspaceId: string,
  name: string,
  fallback: string,
  requested?: string,
): Promise<string> {
  const base = requested ?? resourceSlugBase(name, fallback);
  if (!base || isReservedSlug(base)) {
    throw new DeploymentSurfaceError(
      "invalid",
      `The slug "${base}" is reserved or invalid`,
    );
  }
  const rows = await db
    .select({ slug: table.slug })
    .from(table)
    .where(
      and(
        eq(table.workspaceId, workspaceId),
        or(eq(table.slug, base), like(table.slug, `${base}-%`)),
      ),
    );
  if (requested && rows.some((row) => row.slug === requested)) {
    throw new DeploymentSurfaceError(
      "conflict",
      `The slug "${requested}" is already in use`,
    );
  }
  return nextAvailableSlug(base, new Set(rows.map((row) => row.slug)));
}

async function deploymentFolder(
  workspaceId: string,
  path: string | undefined,
): Promise<{ id: string | null }> {
  const trimmed = path?.trim() ?? "";
  let start = 0;
  let end = trimmed.length;
  while (trimmed[start] === "/") start++;
  while (end > start && trimmed[end - 1] === "/") end--;
  const normalized = trimmed.slice(start, end);
  return normalized ? ensureFolderNode(workspaceId, normalized) : { id: null };
}

export async function workspaceSlug(workspaceId: string): Promise<string> {
  const [workspace] = await db
    .select({ slug: Workspace.slug })
    .from(Workspace)
    .where(eq(Workspace.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw new DeploymentSurfaceError("not_found", "Workspace not found");
  }
  return workspace.slug;
}

const mcpColumns = {
  slug: GroupMcp.slug,
  name: GroupMcp.name,
  instructions: GroupMcp.instructions,
  folderPath: sql<string>`coalesce(${WikiNode.path}, '')`,
  enabled: GroupMcp.enabled,
  tools: GroupMcp.tools,
};

export async function listGroupMcpDeployments(workspaceId: string) {
  return db
    .select(mcpColumns)
    .from(GroupMcp)
    .leftJoin(WikiNode, eq(WikiNode.id, GroupMcp.folderId))
    .where(eq(GroupMcp.workspaceId, workspaceId))
    .orderBy(GroupMcp.slug);
}

export async function getGroupMcpDeployment(workspaceId: string, slug: string) {
  const [deployment] = await db
    .select(mcpColumns)
    .from(GroupMcp)
    .leftJoin(WikiNode, eq(WikiNode.id, GroupMcp.folderId))
    .where(and(eq(GroupMcp.workspaceId, workspaceId), eq(GroupMcp.slug, slug)))
    .limit(1);
  if (!deployment) {
    throw new DeploymentSurfaceError("not_found", "MCP deployment not found");
  }
  return deployment;
}

export async function createGroupMcpDeployment(input: CreateGroupMcpInput) {
  const created = await createGroupMcpRecord(input);
  return getGroupMcpDeployment(input.workspaceId, created.slug);
}

export async function createGroupMcpRecord(input: CreateGroupMcpInput) {
  const slug = await allocateSlug(
    GroupMcp,
    input.workspaceId,
    input.name,
    "mcp",
    input.slug,
  );
  const folder = await deploymentFolder(input.workspaceId, input.folderPath);
  const [created] = await db
    .insert(GroupMcp)
    .values({
      workspaceId: input.workspaceId,
      slug,
      name: input.name,
      folderId: folder.id,
      instructions: input.instructions,
      tools: input.tools,
      authMethods: input.authMethods ?? ["oauth"],
      artifactVisibility: input.artifactVisibility,
    })
    .onConflictDoNothing()
    .returning({ id: GroupMcp.id, slug: GroupMcp.slug });
  if (!created) {
    throw new DeploymentSurfaceError(
      "conflict",
      "The MCP slug is already in use",
    );
  }
  return { ...created, folderId: folder.id };
}

export async function deleteGroupMcpDeployment(
  workspaceId: string,
  slug: string,
): Promise<void> {
  const result = await db
    .delete(GroupMcp)
    .where(and(eq(GroupMcp.workspaceId, workspaceId), eq(GroupMcp.slug, slug)))
    .returning({ id: GroupMcp.id });
  if (!result[0]) {
    throw new DeploymentSurfaceError("not_found", "MCP deployment not found");
  }
}

export const DEFAULT_NIMBUS_TEMPLATE = "templates-v0.6.3";

export interface DocSiteBuildPort {
  enqueue(args: {
    buildId: string;
    docSiteId: string;
    workspaceId: string;
  }): Promise<void>;
}

const docSiteColumns = {
  slug: DocSite.slug,
  name: DocSite.name,
  folderPath: sql<string>`coalesce(${WikiNode.path}, '')`,
  visibility: DocSite.visibility,
  status: DocSite.status,
  templateVersion: DocSite.templateVersion,
  lastBuiltAt: DocSite.lastBuiltAt,
  error: DocSite.error,
  config: DocSite.config,
};

export async function listDocSiteDeployments(workspaceId: string) {
  return db
    .select(docSiteColumns)
    .from(DocSite)
    .leftJoin(WikiNode, eq(WikiNode.id, DocSite.folderId))
    .where(eq(DocSite.workspaceId, workspaceId))
    .orderBy(desc(DocSite.createdAt));
}

export async function getDocSiteDeployment(workspaceId: string, slug: string) {
  const [deployment] = await db
    .select(docSiteColumns)
    .from(DocSite)
    .leftJoin(WikiNode, eq(WikiNode.id, DocSite.folderId))
    .where(and(eq(DocSite.workspaceId, workspaceId), eq(DocSite.slug, slug)))
    .limit(1);
  if (!deployment) {
    throw new DeploymentSurfaceError("not_found", "Docs site not found");
  }
  return deployment;
}

export async function createDocSiteDeployment(input: CreateDocSiteInput) {
  await assertWithinLimit(input.workspaceId, "docsites");
  const folder = await deploymentFolder(input.workspaceId, input.folderPath);
  const slug = await allocateSlug(
    DocSite,
    input.workspaceId,
    input.name,
    "docs",
    input.slug,
  );
  const [created] = await db
    .insert(DocSite)
    .values({
      workspaceId: input.workspaceId,
      folderId: folder.id,
      slug,
      name: input.name,
      visibility: input.visibility ?? "private",
      templateVersion: DEFAULT_NIMBUS_TEMPLATE,
      config: {
        description: input.description,
        instructions: input.instructions,
      },
      createdByUserId: input.userId,
    })
    .onConflictDoNothing()
    .returning({ slug: DocSite.slug });
  if (!created) {
    throw new DeploymentSurfaceError(
      "conflict",
      "The docs site slug is already in use",
    );
  }
  return getDocSiteDeployment(input.workspaceId, created.slug);
}

export async function publishDocSiteDeployment(
  workspaceId: string,
  slug: string,
  port: DocSiteBuildPort,
  userId?: string,
): Promise<{ buildId: string; alreadyBuilding: boolean }> {
  const [site] = await db
    .select({
      id: DocSite.id,
      status: DocSite.status,
      folderId: DocSite.folderId,
    })
    .from(DocSite)
    .where(and(eq(DocSite.workspaceId, workspaceId), eq(DocSite.slug, slug)))
    .limit(1);
  if (!site) {
    throw new DeploymentSurfaceError("not_found", "Docs site not found");
  }
  if (site.status === "building") {
    const [inFlight] = await db
      .select({ id: DocSiteBuild.id })
      .from(DocSiteBuild)
      .where(eq(DocSiteBuild.docSiteId, site.id))
      .orderBy(desc(DocSiteBuild.startedAt))
      .limit(1);
    if (inFlight) return { buildId: inFlight.id, alreadyBuilding: true };
  }

  const [build] = await db
    .insert(DocSiteBuild)
    .values({
      docSiteId: site.id,
      workspaceId,
      status: "queued",
      triggeredByUserId: userId,
    })
    .returning({ id: DocSiteBuild.id });
  if (!build) {
    throw new DeploymentSurfaceError("invalid", "Could not start a build");
  }
  await db
    .update(DocSite)
    .set({ status: "building", error: null })
    .where(eq(DocSite.id, site.id));
  try {
    await port.enqueue({
      buildId: build.id,
      docSiteId: site.id,
      workspaceId,
    });
  } catch (error) {
    await Promise.all([
      db
        .update(DocSiteBuild)
        .set({
          status: "failed",
          error: "Could not enqueue the build",
          finishedAt: new Date(),
        })
        .where(eq(DocSiteBuild.id, build.id)),
      db
        .update(DocSite)
        .set({ status: "failed", error: "Could not enqueue the build" })
        .where(eq(DocSite.id, site.id)),
    ]);
    throw error;
  }
  return { buildId: build.id, alreadyBuilding: false };
}

export async function deleteDocSiteDeployment(
  workspaceId: string,
  slug: string,
): Promise<void> {
  const result = await db
    .delete(DocSite)
    .where(and(eq(DocSite.workspaceId, workspaceId), eq(DocSite.slug, slug)))
    .returning({ id: DocSite.id });
  if (!result[0]) {
    throw new DeploymentSurfaceError("not_found", "Docs site not found");
  }
}
