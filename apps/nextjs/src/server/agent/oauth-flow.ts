import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { ConnectionPlatform } from "@acme/db/schema";
import { requireAccess } from "@acme/api/access";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Agent, AgentConnection } from "@acme/db/schema";

import { getAuthSession } from "~/auth/server";
import { env } from "~/env";
import { encryptConnectionSecret } from "../connection-secret";
import { agentAnchorPath } from "./anchor";

type AgentRow = typeof Agent.$inferSelect;

export type DeployAuth =
  | { ok: true; agent: AgentRow; userId: string }
  | { ok: false; response: Response };

// Shared gate for both install and callback: a live session with manager access
// over the agent's anchor (deploying is the exposure authority, §5.2 of the spec).
export async function authorizeDeploy(
  agentId: string | null,
): Promise<DeployAuth> {
  const session = await getAuthSession();
  if (!session) {
    return {
      ok: false,
      response: new Response("Unauthorized", { status: 401 }),
    };
  }
  if (!agentId) {
    return {
      ok: false,
      response: new Response("Missing agentId", { status: 400 }),
    };
  }
  const [agent] = await db
    .select()
    .from(Agent)
    .where(eq(Agent.id, agentId))
    .limit(1);
  if (!agent) {
    return {
      ok: false,
      response: new Response("Agent not found", { status: 404 }),
    };
  }
  const access = await requireAccess(session.user.id, agent.workspaceId);
  // A null path means the anchor folder is gone — deny rather than fall back
  // to root, which would be the widest possible scope.
  const anchorPath = await agentAnchorPath(
    agent.workspaceId,
    agent.targetFolderId,
  );
  if (anchorPath === null || !access.canManage(anchorPath)) {
    return { ok: false, response: new Response("Forbidden", { status: 403 }) };
  }
  return { ok: true, agent, userId: session.user.id };
}

// Upsert a connection: one active agent per platform install; re-install refreshes
// the token and re-activates.
export async function upsertConnection(args: {
  agent: AgentRow;
  userId: string;
  platform: ConnectionPlatform;
  routeKey: string;
  secretsJson: string;
  meta: Record<string, string>;
}): Promise<void> {
  const shared = {
    agentId: args.agent.id,
    workspaceId: args.agent.workspaceId,
    externalMeta: args.meta,
    secretsEncrypted: encryptConnectionSecret(args.secretsJson),
    status: "active" as const,
    createdByUserId: args.userId,
  };
  await db
    .insert(AgentConnection)
    .values({
      id: randomUUID(),
      platform: args.platform,
      routeKey: args.routeKey,
      ...shared,
    })
    .onConflictDoUpdate({
      target: [AgentConnection.platform, AgentConnection.routeKey],
      set: { ...shared, error: null, updatedAt: new Date() },
    });
}

export function deployedRedirect(agent: AgentRow, redirect?: string): Response {
  if (redirect) {
    const target = new URL(redirect);
    target.searchParams.set("slug", agent.slug);
    return NextResponse.redirect(target);
  }
  return NextResponse.redirect(
    `${env.NIMBASE_WEB_URL}/dashboard/workspaces/${agent.workspaceId}`,
  );
}

export function deploymentFailure(
  redirect: string | undefined,
  code: string,
  status: number,
): Response {
  if (!redirect) {
    return new Response(code.replaceAll("_", " "), { status });
  }
  const target = new URL(redirect);
  target.searchParams.set("error", code);
  return NextResponse.redirect(target);
}
