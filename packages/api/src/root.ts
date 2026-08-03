import { accessRouter } from "./router/access";
import { agentRouter } from "./router/agent";
import { aiConfigRouter, workspaceAiConfigRouter } from "./router/ai-config";
import { artifactRouter } from "./router/artifact";
import { authRouter } from "./router/auth";
import { billingRouter } from "./router/billing";
import { connectionsRouter } from "./router/connections";
import { docSiteRouter } from "./router/doc-site";
import { groupMcpRouter } from "./router/group-mcp";
import { groupsRouter } from "./router/groups";
import { kbRouter } from "./router/kb";
import { membersRouter } from "./router/members";
import { operatorRouter } from "./router/operator";
import { sourcesRouter } from "./router/sources";
import { tokenRouter } from "./router/token";
import { workspaceRouter } from "./router/workspace";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  access: accessRouter,
  agent: agentRouter,
  aiConfig: aiConfigRouter,
  auth: authRouter,
  billing: billingRouter,
  artifact: artifactRouter,
  connections: connectionsRouter,
  docSite: docSiteRouter,
  groupMcp: groupMcpRouter,
  groups: groupsRouter,
  kb: kbRouter,
  members: membersRouter,
  operator: operatorRouter,
  sources: sourcesRouter,
  token: tokenRouter,
  workspace: workspaceRouter,
  workspaceAiConfig: workspaceAiConfigRouter,
});

export type AppRouter = typeof appRouter;
