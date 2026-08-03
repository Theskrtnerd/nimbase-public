import { NextResponse } from "next/server";
import { z } from "zod/v4";

import { EntitlementError } from "@acme/api/entitlements";
import { sourceMetadataSchema } from "@acme/db/schema";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { resolveTargetFolderPath } from "~/server/folders";
import { ingestSource } from "~/server/ingest/ingest-source";

export const runtime = "nodejs";

const Body = z.object({
  workspaceId: z.uuid().optional(),
  kind: z.enum(["web", "chat_export", "highlight", "file"]),
  sourceUrl: z.url().optional(),
  title: z.string().max(512).optional(),
  text: z.string().optional(),
  capturedAt: z.string().optional(),
  idempotencyKey: z.string().optional(),
  targetFolderId: z.uuid().optional(),
  metadata: sourceMetadataSchema.optional(),
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

  const targetFolderId = body.targetFolderId ?? null;
  const target = await resolveTargetFolderPath(
    authz.workspaceId,
    targetFolderId,
  );
  if (!target) {
    return NextResponse.json(
      { error: "target folder not found" },
      { status: 404 },
    );
  }
  if (!authz.access.canCapture(target.path)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await ingestSource(
      {
        kind: body.kind,
        sourceUrl: body.sourceUrl,
        title: body.title,
        text: body.text,
        capturedAt: body.capturedAt,
        idempotencyKey: body.idempotencyKey,
        metadata: body.metadata,
      },
      {
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        targetFolderId,
      },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json(
        { error: "limit_reached", dimension: err.dimension, limit: err.limit },
        { status: 402 },
      );
    }
    console.error("[ingest] failed", err);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
}
