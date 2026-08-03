import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { and, asc, count, desc, eq, isNotNull, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import {
  Artifact,
  Source,
  WikiNode,
  Workspace,
  WorkspaceMember,
} from "@acme/db/schema";

import { logGodModeAccess } from "../lib/operator";
import { operatorProcedure } from "../trpc";

// Read-only support view. Caps mirror the member-facing routers (sources.list,
// kb.listCompiledNodes) so god mode never pulls an unbounded result set.
const MAX_ROWS = 100;

export const operatorRouter = {
  // One aggregate read for the /admin support view: workspace metadata, member
  // roster, top compiled KB nodes, plus source/artifact counts. Operator-gated
  // via operatorProcedure; every call writes one OperatorAuditLog row.
  workspaceDetail: operatorProcedure.query(async ({ ctx, input }) => {
    const [workspaceRows, members, sourceCountRow, artifactCountRow, nodes] =
      await Promise.all([
        db
          .select({
            id: Workspace.id,
            name: Workspace.name,
            description: Workspace.description,
            ownerUserId: Workspace.ownerUserId,
            createdAt: Workspace.createdAt,
          })
          .from(Workspace)
          .where(eq(Workspace.id, input.workspaceId))
          .limit(1),
        db
          .select({
            id: WorkspaceMember.id,
            userId: WorkspaceMember.userId,
            role: WorkspaceMember.role,
            name: WorkspaceMember.name,
            email: WorkspaceMember.email,
            createdAt: WorkspaceMember.createdAt,
          })
          .from(WorkspaceMember)
          .where(eq(WorkspaceMember.workspaceId, input.workspaceId))
          .orderBy(asc(WorkspaceMember.createdAt)),
        db
          .select({ value: count() })
          .from(Source)
          .where(eq(Source.workspaceId, input.workspaceId)),
        db
          .select({ value: count() })
          .from(Artifact)
          .where(eq(Artifact.workspaceId, input.workspaceId)),
        db
          .select({
            id: WikiNode.id,
            path: WikiNode.path,
            title: WikiNode.title,
            updatedAt: WikiNode.updatedAt,
          })
          .from(WikiNode)
          .where(
            and(
              eq(WikiNode.workspaceId, input.workspaceId),
              isNotNull(WikiNode.currentVersionId),
              isNull(WikiNode.deletedAt),
            ),
          )
          .orderBy(desc(WikiNode.updatedAt))
          .limit(MAX_ROWS),
      ]);

    const workspace = workspaceRows[0];
    if (!workspace) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Workspace not found",
      });
    }

    await logGodModeAccess({
      operatorUserId: ctx.session.user.id,
      workspaceId: input.workspaceId,
      action: "workspace.detail",
    });

    return {
      workspace,
      members,
      nodes,
      sourceCount: sourceCountRow[0]?.value ?? 0,
      artifactCount: artifactCountRow[0]?.value ?? 0,
      viaGodMode: ctx.access.viaGodMode,
    };
  }),
} satisfies TRPCRouterRecord;
