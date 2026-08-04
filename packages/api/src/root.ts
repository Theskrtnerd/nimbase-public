import { accessRouter } from "./router/access";
import { agentRouter } from "./router/agent";
import { workspaceAiConfigRouter } from "./router/ai-config";
import { artifactRouter } from "./router/artifact";
import { authRouter } from "./router/auth";
import { connectionsRouter } from "./router/connections";
import { groupMcpRouter } from "./router/group-mcp";
import { groupsRouter } from "./router/groups";
import { kbRouter } from "./router/kb";
import { membersRouter } from "./router/members";
import { sourcesRouter } from "./router/sources";
import { tokenRouter } from "./router/token";
import { workspaceRouter } from "./router/workspace";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  access: accessRouter,
  agent: agentRouter,
  auth: authRouter,
  artifact: artifactRouter,
  connections: connectionsRouter,
  groupMcp: groupMcpRouter,
  groups: groupsRouter,
  kb: kbRouter,
  members: membersRouter,
  sources: sourcesRouter,
  token: tokenRouter,
  workspace: workspaceRouter,
  workspaceAiConfig: workspaceAiConfigRouter,
});

export type AppRouter = typeof appRouter;
