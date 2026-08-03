import { NextResponse } from "next/server";
import { z } from "zod/v4";

import { EntitlementError } from "@acme/api/entitlements";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { resolveTargetFolderPath } from "~/server/folders";
import {
  BinaryIngestError,
  presignBinarySource,
} from "~/server/ingest/ingest-binary";

export const runtime = "nodejs";

const Body = z.object({
  workspaceId: z.uuid().optional(),
  kind: z.enum(["screenshot", "voice", "video", "file"]),
  mimeType: z.string().min(1).max(100),
  title: z.string().max(512).optional(),
  sourceUrl: z.url().optional(),
  capturedAt: z.string().optional(),
  sizeBytes: z.number().int().positive(),
  targetFolderId: z.uuid().optional(),
  // The real captured filename — required for "file" (drives its extension).
  originalFilename: z.string().max(255).optional(),
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
    const result = await presignBinarySource(
      {
        kind: body.kind,
        mimeType: body.mimeType,
        title: body.title,
        sourceUrl: body.sourceUrl,
        capturedAt: body.capturedAt,
        sizeBytes: body.sizeBytes,
        originalFilename: body.originalFilename,
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
    if (err instanceof BinaryIngestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[ingest/presign] failed", err);
    return NextResponse.json({ error: "presign_failed" }, { status: 500 });
  }
}
