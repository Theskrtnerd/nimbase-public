import { NextResponse } from "next/server";
import { z } from "zod/v4";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import {
  BinaryIngestError,
  finalizeBinarySource,
} from "~/server/ingest/ingest-binary";

export const runtime = "nodejs";

const Body = z.object({
  workspaceId: z.uuid().optional(),
  sourceId: z.uuid(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const authorized = await authorizeWorkspaceRequest(req, body.workspaceId);
  if (!authorized.ok) return authzErrorResponse(authorized);

  try {
    const result = await finalizeBinarySource(body.sourceId, {
      workspaceId: authorized.workspaceId,
      userId: authorized.userId,
      // targetFolderId was already stored on the Source row during presign.
      targetFolderId: null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BinaryIngestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[ingest/finalize] failed", err);
    return NextResponse.json({ error: "finalize_failed" }, { status: 500 });
  }
}
