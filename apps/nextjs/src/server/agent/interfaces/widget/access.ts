import "server-only";

import type { WidgetInterfaceConfig } from "@acme/db/schema";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import {
  Agent,
  AgentConnection,
  widgetInterfaceConfigSchema,
  WikiNode,
} from "@acme/db/schema";

export interface WidgetInterfaceContext {
  agent: typeof Agent.$inferSelect;
  connection: typeof AgentConnection.$inferSelect;
  config: WidgetInterfaceConfig;
  // Empty string is the centralized KB root. Null means a configured anchor
  // has disappeared and the public interface must fail closed.
  folderPath: string | null;
}

// A widget key resolves an AgentConnection, never a separate memory principal.
// The Agent owns persona, anchor, grants, budget, and lifecycle; this adapter
// contributes only public delivery configuration.
export async function loadWidgetInterfaceContext(
  publicKey: string,
): Promise<WidgetInterfaceContext | null> {
  const [row] = await db
    .select({
      agent: Agent,
      connection: AgentConnection,
      folderPath: WikiNode.path,
    })
    .from(AgentConnection)
    .innerJoin(Agent, eq(Agent.id, AgentConnection.agentId))
    .leftJoin(
      WikiNode,
      and(eq(WikiNode.id, Agent.targetFolderId), isNull(WikiNode.deletedAt)),
    )
    .where(
      and(
        eq(AgentConnection.platform, "widget"),
        eq(AgentConnection.routeKey, publicKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  const config = widgetInterfaceConfigSchema.safeParse(
    row.connection.interfaceConfig,
  );
  if (!config.success) return null;
  if (row.agent.targetFolderId && !row.folderPath) {
    return { ...row, config: config.data, folderPath: null };
  }
  return { ...row, config: config.data, folderPath: row.folderPath ?? "" };
}
