import type {
  ArtifactVisibility,
  GroupMcpTool,
  McpAuthMethod,
} from "@acme/db/schema";
import { and, eq, like, or, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { GroupMcp, WikiNode, Workspace } from "@acme/db/schema";
import {
  isReservedSlug,
  nextAvailableSlug,
  resourceSlugBase,
} from "@acme/db/slug";

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

async function allocateSlug(
  table: typeof GroupMcp,
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
