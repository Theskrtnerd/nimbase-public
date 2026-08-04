import { TRPCError } from "@trpc/server";

import type { SQL } from "@acme/db";
import type { GrantRole, WorkspaceRole } from "@acme/db/schema";
import { and, eq, inArray, isNull, or, pathScopeMatchSql, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  AccessGrant,
  UserProfile,
  WikiNode,
  WorkspaceGroupMember,
  WorkspaceMember,
} from "@acme/db/schema";

import type { PathScope, ResolvedGrant } from "./access-core";
import { computeScopes, hasRoleAtPath } from "./access-core";

export interface AccessContext {
  workspaceId: string;
  userId: string | null;
  // Stable company identity used by restricted provider ACL evaluation. Null
  // principals can still read workspace-visible provider evidence through
  // their existing workspace/folder fence.
  userProfileId: string | null;
  role: WorkspaceRole;
  isAdmin: boolean; // owner or admin — full bypass, restricted included
  grants: ResolvedGrant[];
  restricted: string[];
  canRead(path: string): boolean;
  canCapture(path: string): boolean;
  canManage(path: string): boolean;
  // null = unrestricted (admin). [] = no access at this role.
  scopes(minRole: GrantRole): PathScope[] | null;
}

export function buildAccessContext(args: {
  workspaceId: string;
  userId: string | null;
  userProfileId?: string | null;
  role: WorkspaceRole;
  grants: ResolvedGrant[];
  restricted: string[];
}): AccessContext {
  const isAdmin = args.role === "owner" || args.role === "admin";
  const has = (min: GrantRole, path: string) =>
    isAdmin || hasRoleAtPath(args.grants, args.restricted, path, min);
  return {
    workspaceId: args.workspaceId,
    userId: args.userId,
    userProfileId: args.userProfileId ?? null,
    role: args.role,
    isAdmin,
    grants: args.grants,
    restricted: args.restricted,
    canRead: (path) => has("viewer", path),
    canCapture: (path) => has("contributor", path),
    canManage: (path) => has("manager", path),
    scopes: (minRole) =>
      isAdmin ? null : computeScopes(args.grants, args.restricted, minRole),
  };
}

// One shared query for a workspace's restricted-folder boundaries — the fence
// input every scope computation needs. Every principal resolver (member, agent,
// deployment anchor) goes through this so the boundary rule cannot drift.
export async function loadRestrictedPaths(
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ path: WikiNode.path })
    .from(WikiNode)
    .where(
      and(
        eq(WikiNode.workspaceId, workspaceId),
        eq(WikiNode.restricted, true),
        isNull(WikiNode.deletedAt),
      ),
    );
  return rows.map((row) => row.path);
}

// ---------------------------------------------------------------------------
// A deployment anchor is authorized by exactly one folder grant, bounded by
// the workspace's restricted subtrees. No membership, grant intersection, or
// admin bypass is implied by the deployment itself.
// ---------------------------------------------------------------------------

// Scope-shaped anchor (widgets, agent-style read fences). A missing folder
// path yields no scopes at all: fail closed.
export function anchoredScopes(
  folderPath: string | null,
  restricted: string[],
  role: GrantRole = "viewer",
): PathScope[] {
  if (folderPath === null) return [];
  return computeScopes([{ prefix: folderPath, role }], restricted, "viewer");
}

// AccessContext-shaped anchor (group MCP). Role "member" with a single grant —
// mirrors how authorizeApiToken builds a token's context; never admin.
export function anchoredContext(args: {
  workspaceId: string;
  userId: string | null;
  userProfileId?: string | null;
  folderPath: string;
  role: "viewer" | "contributor";
  restricted: string[];
}): AccessContext {
  return buildAccessContext({
    workspaceId: args.workspaceId,
    userId: args.userId,
    userProfileId: args.userProfileId,
    role: "member",
    grants: [{ prefix: args.folderPath, role: args.role }],
    restricted: args.restricted,
  });
}

// Membership + grants + restricted boundaries for one user in one workspace.
export async function resolveAccess(
  userId: string,
  workspaceId: string,
): Promise<AccessContext | null> {
  const [member] = await db
    .select({
      role: WorkspaceMember.role,
      userProfileId: WorkspaceMember.userProfileId,
    })
    .from(WorkspaceMember)
    .innerJoin(
      UserProfile,
      and(
        eq(UserProfile.id, WorkspaceMember.userProfileId),
        eq(UserProfile.workspaceId, WorkspaceMember.workspaceId),
        eq(UserProfile.status, "active"),
      ),
    )
    .where(
      and(
        eq(WorkspaceMember.workspaceId, workspaceId),
        eq(WorkspaceMember.userId, userId),
      ),
    )
    .limit(1);
  if (!member) return null;

  if (member.role === "owner" || member.role === "admin") {
    return buildAccessContext({
      workspaceId,
      userId,
      userProfileId: member.userProfileId,
      role: member.role,
      grants: [],
      restricted: [],
    });
  }

  const [groupRows, restricted] = await Promise.all([
    db
      .select({ groupId: WorkspaceGroupMember.groupId })
      .from(WorkspaceGroupMember)
      .where(eq(WorkspaceGroupMember.userId, userId)),
    loadRestrictedPaths(workspaceId),
  ]);
  const groupIds = groupRows.map((row) => row.groupId);

  const grantRows = await db
    .select({
      role: AccessGrant.role,
      folderId: AccessGrant.folderId,
      folderPath: WikiNode.path,
      folderDeletedAt: WikiNode.deletedAt,
    })
    .from(AccessGrant)
    .leftJoin(WikiNode, eq(WikiNode.id, AccessGrant.folderId))
    .where(
      and(
        eq(AccessGrant.workspaceId, workspaceId),
        or(
          eq(AccessGrant.principalType, "all_members"),
          and(
            eq(AccessGrant.principalType, "user"),
            eq(AccessGrant.principalId, userId),
          ),
          groupIds.length > 0
            ? and(
                eq(AccessGrant.principalType, "group"),
                inArray(AccessGrant.principalId, groupIds),
              )
            : sql`false`,
        ),
      ),
    );

  const grants: ResolvedGrant[] = grantRows.flatMap((row) => {
    if (row.folderId === null) return [{ prefix: "", role: row.role }];
    if (row.folderPath === null || row.folderDeletedAt !== null) return [];
    return [{ prefix: row.folderPath, role: row.role }];
  });

  return buildAccessContext({
    workspaceId,
    userId,
    userProfileId: member.userProfileId,
    role: member.role,
    grants,
    restricted,
  });
}

export async function requireAccess(
  userId: string,
  workspaceId: string,
): Promise<AccessContext> {
  const access = await resolveAccess(userId, workspaceId);
  if (!access) {
    // NOT_FOUND, not FORBIDDEN — non-members must not learn the workspace exists.
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }
  return access;
}

export function assertAdmin(access: AccessContext): void {
  if (!access.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin required" });
  }
}

// Read filter for tables anchored on a (possibly null or soft-deleted) target
// folder — Source.targetFolderId, Artifact.targetFolderId. The folder row is
// leftJoin'd; a missing/deleted folder falls back to root "" so root-readers
// still see the row. Returns the path expression to select and the scope filter
// to AND into the WHERE. Centralizes the sources.list / artifact.list pattern.
// `minRole` defaults to viewer (sources/artifact/agent visibility). token.list
// passes "manager" — a token is a credential, so who-holds-what is
// manager-level information. That single knob is why token.list had to
// re-implement this function inline.
export function targetFolderReadFilter(
  access: AccessContext,
  minRole: GrantRole = "viewer",
): {
  targetPath: SQL<string>;
  scopeFilter: SQL | undefined;
} {
  const targetPath = sql<string>`coalesce(${WikiNode.path}, '')`;
  return {
    targetPath,
    scopeFilter: pathScopeWhere(targetPath, access.scopes(minRole)),
  };
}

// SQL prefix filter over any path-valued expression (column or coalesce()).
// null scopes (admin) → undefined (no filter). Empty scopes → FALSE. Otherwise
// the shared pathScopeMatchSql builder (@acme/db) — the same one search uses, so
// LIKE-escaping cannot drift. The result is exactly equivalent to pathInScopes.
export function pathScopeWhere(
  pathExpr: SQL | { getSQL(): SQL },
  scopes: PathScope[] | null,
): SQL | undefined {
  if (scopes === null) return undefined;
  if (scopes.length === 0) return sql`false`;
  return pathScopeMatchSql(pathExpr, scopes);
}

// The agent's read capability. An agent is a grant principal (principalType
// "agent", principalId = agentId) with NO membership and NO admin bypass — its
// scope is purely its explicit grants. Mirrors the grant branch of resolveAccess
// and reuses computeScopes, so the algebra (and restricted boundaries) cannot
// drift. Resolved live per turn, so admin grant edits and revocations propagate.
export async function resolveAgentScopes(
  agentId: string,
  workspaceId: string,
): Promise<PathScope[]> {
  const [grantRows, restricted] = await Promise.all([
    db
      .select({
        role: AccessGrant.role,
        folderId: AccessGrant.folderId,
        folderPath: WikiNode.path,
        folderDeletedAt: WikiNode.deletedAt,
      })
      .from(AccessGrant)
      .leftJoin(WikiNode, eq(WikiNode.id, AccessGrant.folderId))
      .where(
        and(
          eq(AccessGrant.workspaceId, workspaceId),
          eq(AccessGrant.principalType, "agent"),
          eq(AccessGrant.principalId, agentId),
        ),
      ),
    loadRestrictedPaths(workspaceId),
  ]);

  const grants: ResolvedGrant[] = grantRows.flatMap((row) => {
    if (row.folderId === null) return [{ prefix: "", role: row.role }];
    if (row.folderPath === null || row.folderDeletedAt !== null) return [];
    return [{ prefix: row.folderPath, role: row.role }];
  });

  return computeScopes(grants, restricted, "viewer");
}
