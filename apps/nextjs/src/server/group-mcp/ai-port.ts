import "server-only";

import type { GroupMcpAIPort } from "@acme/api";

import { proposeGroupMcpFromPrompt } from "~/server/group-mcp/propose";

// Real GroupMcpAIPort adapter, wired into the dashboard tRPC context
// (`app/api/trpc/[trpc]/route.ts`). Thin pass-through to the agentic
// read-only KB loop in `propose.ts` — same pattern as `tokensPort`.
export const groupMcpAIPort: GroupMcpAIPort = {
  propose(args) {
    return proposeGroupMcpFromPrompt(args);
  },
};
