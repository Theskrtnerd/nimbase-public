import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { ConnectionPlatform, ConnectionStatus } from "@acme/db/schema";
import { and, desc, eq, isNull, ne, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  AccessGrant,
  Agent,
  AgentConnection,
  AgentTurn,
  artifactVisibilitySchema,
  WikiNode,
} from "@acme/db/schema";

import type { AccessContext } from "../lib/access";
import { requireAccess, targetFolderReadFilter } from "../lib/access";
import {
  createDeployment,
  DeploymentControlError,
} from "../lib/deployment-control";
import { anchorFolderPath } from "../lib/folders";
import { protectedProcedure, workspaceProcedure } from "../trpc";

type AgentRow = typeof Agent.$inferSelect;

// Resolve an anchor folder's path. A null folderId is root (""); a folderId
// that resolves to nothing is a hard NOT_FOUND rather than a fall back to "",
// because "" is the widest prefix — see anchorFolderPath.
async function anchorPath(
  workspaceId: string,
  folderId: string | null,
): Promise<string> {
  const path = await anchorFolderPath(workspaceId, folderId);
  if (path === null) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Anchor folder not found",
    });
  }
  return path;
}

// Load an agent by id and resolve the caller's access in its workspace once.
async function loadAccessibleAgent(userId: string, id: string) {
  const [agent] = await db
    .select()
    .from(Agent)
    .where(eq(Agent.id, id))
    .limit(1);
  if (!agent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  }
  const access = await requireAccess(userId, agent.workspaceId);
  return { agent, access };
}

// Gate an id-addressed agent endpoint on the caller's role over the agent's
// anchor folder. Capability (what the agent reads) is admin-controlled grants;
// this is the exposure/management gate.
async function assertAgentFolderAccess(
  agent: AgentRow,
  access: AccessContext,
  min: "read" | "manage",
): Promise<void> {
  const path = await anchorPath(agent.workspaceId, agent.targetFolderId);
  const ok = min === "manage" ? access.canManage(path) : access.canRead(path);
  if (!ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        min === "manage"
          ? "Manager access over the agent's folder required"
          : "No read access",
    });
  }
}

export const agentRouter = {
  // An agent is visible iff its anchor folder is readable (shared filter with
  // artifact/sources).
  list: workspaceProcedure.query(async ({ ctx, input }) => {
    const { targetPath, scopeFilter } = targetFolderReadFilter(ctx.access);
    // Where each agent is actually deployed, aggregated in the same round trip
    // rather than N+1 `connections` calls from the list UI. Revoked rows are
    // excluded by the join — a revoked connection is not a deployment — but
    // errored ones are kept so a broken install stays visible instead of
    // silently vanishing from the list.
    const deployments = sql<
      { platform: ConnectionPlatform; status: ConnectionStatus }[]
    >`coalesce(
        json_agg(distinct jsonb_build_object(
          'platform', ${AgentConnection.platform},
          'status', ${AgentConnection.status}
        )) filter (where ${AgentConnection.id} is not null),
        '[]'
      )`;
    return db
      .select({
        id: Agent.id,
        slug: Agent.slug,
        name: Agent.name,
        enabled: Agent.enabled,
        targetPath,
        deployments,
        createdAt: Agent.createdAt,
        updatedAt: Agent.updatedAt,
      })
      .from(Agent)
      .leftJoin(
        WikiNode,
        and(eq(WikiNode.id, Agent.targetFolderId), isNull(WikiNode.deletedAt)),
      )
      .leftJoin(
        AgentConnection,
        and(
          eq(AgentConnection.agentId, Agent.id),
          ne(AgentConnection.status, "revoked"),
        ),
      )
      .where(and(eq(Agent.workspaceId, input.workspaceId), scopeFilter))
      .groupBy(Agent.id, WikiNode.path)
      .orderBy(desc(Agent.updatedAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { agent, access } = await loadAccessibleAgent(
        ctx.session.user.id,
        input.id,
      );
      await assertAgentFolderAccess(agent, access, "read");
      return {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        instructions: agent.instructions,
        targetFolderId: agent.targetFolderId,
        enabled: agent.enabled,
        artifactEnabled: agent.artifactEnabled,
        artifactVisibility: agent.artifactVisibility,
        createdAt: agent.createdAt,
      };
    }),

  // Create an agent and its default `viewer @ anchor` grant atomically. Requires
  // manager on the anchor — which guarantees the new agent's scope ⊆ creator's.
  create: workspaceProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        instructions: z.string().max(8000).optional(),
        targetFolderId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const deployment = await createDeployment({
          access: ctx.access,
          userId: ctx.session.user.id,
          name: input.name,
          instructions: input.instructions,
          targetFolderId: input.targetFolderId,
        });
        return { id: deployment.id, slug: deployment.slug };
      } catch (error) {
        if (error instanceof DeploymentControlError) {
          throw new TRPCError({
            code: error.code === "forbidden" ? "FORBIDDEN" : "NOT_FOUND",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  // Editable: persona, name, enabled, artifact authoring. The anchor is fixed at
  // creation (changing it would mean migrating the default grant — out of scope
  // for v1). Artifact fields ride the same manager-on-anchor gate as deployment:
  // whoever exposes this agent through an interface decides what it may publish.
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        instructions: z.string().max(8000).optional(),
        enabled: z.boolean().optional(),
        artifactEnabled: z.boolean().optional(),
        artifactVisibility: artifactVisibilitySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { agent, access } = await loadAccessibleAgent(
        ctx.session.user.id,
        input.id,
      );
      await assertAgentFolderAccess(agent, access, "manage");
      await db
        .update(Agent)
        .set({
          name: input.name ?? agent.name,
          instructions: input.instructions ?? agent.instructions,
          enabled: input.enabled ?? agent.enabled,
          artifactEnabled: input.artifactEnabled ?? agent.artifactEnabled,
          artifactVisibility:
            input.artifactVisibility ?? agent.artifactVisibility,
          updatedAt: new Date(),
        })
        .where(eq(Agent.id, agent.id));
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { agent, access } = await loadAccessibleAgent(
        ctx.session.user.id,
        input.id,
      );
      await assertAgentFolderAccess(agent, access, "manage");
      // Connections + turns cascade via FK; the agent's grants have no FK to it.
      // neon-http has no interactive transactions; db.batch runs both deletes
      // atomically in a single round-trip.
      await db.batch([
        db.delete(Agent).where(eq(Agent.id, agent.id)),
        db
          .delete(AccessGrant)
          .where(
            and(
              eq(AccessGrant.workspaceId, agent.workspaceId),
              eq(AccessGrant.principalType, "agent"),
              eq(AccessGrant.principalId, agent.id),
            ),
          ),
      ]);
      return { ok: true };
    }),

  // Deployments for one agent (secrets never leave the server).
  connections: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { agent, access } = await loadAccessibleAgent(
        ctx.session.user.id,
        input.agentId,
      );
      await assertAgentFolderAccess(agent, access, "read");
      return db
        .select({
          id: AgentConnection.id,
          platform: AgentConnection.platform,
          externalMeta: AgentConnection.externalMeta,
          status: AgentConnection.status,
          error: AgentConnection.error,
          createdAt: AgentConnection.createdAt,
        })
        .from(AgentConnection)
        .where(eq(AgentConnection.agentId, agent.id))
        .orderBy(desc(AgentConnection.createdAt));
    }),

  revokeConnection: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [conn] = await db
        .select()
        .from(AgentConnection)
        .where(eq(AgentConnection.id, input.connectionId))
        .limit(1);
      if (!conn) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connection not found",
        });
      }
      const { agent, access } = await loadAccessibleAgent(
        ctx.session.user.id,
        conn.agentId,
      );
      await assertAgentFolderAccess(agent, access, "manage");
      await db
        .update(AgentConnection)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(AgentConnection.id, conn.id));
      return { ok: true };
    }),

  // The agent's turn log — its activity/observability panel.
  turns: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { agent, access } = await loadAccessibleAgent(
        ctx.session.user.id,
        input.agentId,
      );
      await assertAgentFolderAccess(agent, access, "read");
      return db
        .select({
          id: AgentTurn.id,
          connectionId: AgentTurn.connectionId,
          channelKey: AgentTurn.channelKey,
          question: AgentTurn.question,
          answer: AgentTurn.answer,
          tokens: AgentTurn.tokens,
          costCents: AgentTurn.costCents,
          error: AgentTurn.error,
          createdAt: AgentTurn.createdAt,
        })
        .from(AgentTurn)
        .where(eq(AgentTurn.agentId, agent.id))
        .orderBy(desc(AgentTurn.createdAt))
        .limit(input.limit ?? 50);
    }),
} satisfies TRPCRouterRecord;
