import { NextResponse } from "next/server";
import { z } from "zod/v4";

import {
  ToolsetForbiddenError,
  toProviderContext,
  toSearchHit,
} from "@acme/cloud";
import { memoryProvider } from "@acme/cloud/memory/wiki-pg-provider";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";

const Body = z.object({
  workspaceId: z.uuid().optional(),
  query: z.string().max(500),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const authz = await authorizeWorkspaceRequest(req, body.workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);

  // Through the MemoryProvider seam; map back to the flat hit shape
  // (nodeId/path/title/snippet/score) the CLI parses.
  const found = await memoryProvider
    .search(toProviderContext(authz.access), {
      text: body.query,
      limit: body.limit,
    })
    .catch((err: unknown) => {
      // Empty read scope trips the kernel toolset gate; a principal that sees
      // nothing gets an empty result set, not a 500.
      if (err instanceof ToolsetForbiddenError) return [];
      throw err;
    });
  const results = found.map(toSearchHit);

  return NextResponse.json({ results });
}
