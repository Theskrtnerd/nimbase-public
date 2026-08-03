import "server-only";

import { randomUUID } from "node:crypto";

import type { BrainInitPort } from "@acme/api";

import { dispatchBrainInit } from "~/server/brain/dispatch";

// Real BrainInitPort adapter, wired into the dashboard tRPC context
// (`app/api/trpc/[trpc]/route.ts`). Thin pass-through to the queue dispatch
// — same pattern as `groupMcpAIPort`.
export const brainInitPort: BrainInitPort = {
  async enqueue({ workspaceId, websiteUrl, identitySources }) {
    await dispatchBrainInit({
      jobId: randomUUID(),
      workspaceId,
      websiteUrl,
      identitySource: websiteUrl ? "website" : "manual",
      identitySources,
    });
  },
};
