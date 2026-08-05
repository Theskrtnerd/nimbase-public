import { projectPendingMemoryHistory } from "@acme/runtime/memory/git-history";
import { memoryGitProjectionJobSchema } from "@acme/runtime/queue";

import { verifyQstashSignature } from "~/server/qstash";

export const runtime = "nodejs";

const Body = memoryGitProjectionJobSchema;

async function handler(request: Request): Promise<Response> {
  const data = Body.parse(await request.json());
  const projected = await projectPendingMemoryHistory(data.workspaceId);
  return Response.json({ ok: true, projected });
}

export const POST = verifyQstashSignature(handler);
