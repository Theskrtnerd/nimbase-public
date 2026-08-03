import { NextResponse } from "next/server";
import { z } from "zod/v4";

import { and, desc, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { ApiToken, WikiNode } from "@acme/db/schema";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { mintToken } from "~/server/auth/mint-token";
import { resolveTargetFolderPath } from "~/server/folders";

export const runtime = "nodejs";

// Role clamped to viewer|contributor here — a minted token can never carry
// manager (no permission changes, no minting further tokens).
const Body = z.object({
  workspaceId: z.uuid(),
  role: z.enum(["viewer", "contributor"]),
  targetFolderId: z.uuid().nullable().optional(),
  label: z.string().trim().min(1).max(120),
  // ISO timestamp; omitted = no expiry. Set it for tokens handed to external
  // external consumers so access decays by default.
  expiresAt: z.iso.datetime().optional(),
});

// POST /api/tokens — mint a folder-scoped ApiToken. User session only (an
// ApiToken cannot mint tokens) with manage rights on the target scope. Returns
// the raw token once.
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const authz = await authorizeWorkspaceRequest(req, body.workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);
  // A token must never mint another token.
  if (authz.userId === null) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const folderId = body.targetFolderId ?? null;
  const target = await resolveTargetFolderPath(authz.workspaceId, folderId);
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!authz.access.canManage(target.path)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const minted = await mintToken({
    workspaceId: authz.workspaceId,
    role: body.role,
    folderId,
    label: body.label,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  });
  return NextResponse.json(minted);
}

// GET /api/tokens — list tokens the caller can manage (no secrets). User
// session only; each token is filtered by canManage on its folder scope.
export async function GET(req: Request) {
  const workspaceId =
    new URL(req.url).searchParams.get("workspaceId") ?? undefined;
  const authz = await authorizeWorkspaceRequest(req, workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);
  if (authz.userId === null) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: ApiToken.id,
      label: ApiToken.label,
      role: ApiToken.role,
      folderId: ApiToken.folderId,
      folderPath: WikiNode.path,
      lastUsedAt: ApiToken.lastUsedAt,
      expiresAt: ApiToken.expiresAt,
      createdAt: ApiToken.createdAt,
    })
    .from(ApiToken)
    .leftJoin(
      WikiNode,
      and(eq(WikiNode.id, ApiToken.folderId), isNull(WikiNode.deletedAt)),
    )
    .where(eq(ApiToken.workspaceId, authz.workspaceId))
    .orderBy(desc(ApiToken.createdAt));

  const tokens = rows.flatMap((t) =>
    authz.access.canManage(t.folderPath ?? "")
      ? [
          {
            id: t.id,
            label: t.label,
            role: t.role,
            folderId: t.folderId,
            lastUsedAt: t.lastUsedAt,
            expiresAt: t.expiresAt,
            createdAt: t.createdAt,
          },
        ]
      : [],
  );

  return NextResponse.json({ tokens });
}
