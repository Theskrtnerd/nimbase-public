import { NextResponse } from "next/server";
import { z } from "zod/v4";

import { EntitlementError } from "@acme/api/entitlements";
import {
  artifactVisibilitySchema,
  resourceSlugSchema,
} from "@acme/validators/cli";

import {
  ArtifactCreateError,
  createArtifact,
} from "~/server/artifact/create-artifact";
import { listArtifactsForAccess } from "~/server/artifact/list-artifacts";
import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { resolveTargetFolderPath } from "~/server/folders";

export const runtime = "nodejs";
// In prod this returns in milliseconds; the generous ceiling only matters for
// local dev, where dispatch runs the generation inline.
export const maxDuration = 300;

const Body = z.strictObject({
  workspaceId: z.uuid().optional(),
  artifactId: z.uuid().optional(),
  prompt: z.string().trim().min(1).max(2000),
  kind: z.enum(["freeform", "fixed"]).default("fixed"),
  themeMode: z.enum(["app", "custom"]).default("app"),
  themeDescription: z.string().max(2000).optional(),
  targetFolderId: z.uuid().optional(),
  visibility: artifactVisibilitySchema.optional(),
  slug: resourceSlugSchema.optional(),
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
  const { workspaceId, access } = authorized;

  // Resolve the target space (null = root) and require capture access on it —
  // creating an artifact is a contribution to that subtree.
  const targetFolderId = body.targetFolderId ?? null;
  const target = await resolveTargetFolderPath(workspaceId, targetFolderId);
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!access.canCapture(target.path)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Snapshot the creator's read scopes to fence the generator's KB tools.
  const readScopes = access.scopes("viewer");

  try {
    const result = await createArtifact(
      {
        prompt: body.prompt,
        kind: body.kind,
        themeMode: body.themeMode,
        themeDescription: body.themeDescription,
        visibility: body.visibility,
        slug: body.slug,
        artifactId: body.artifactId,
      },
      { workspaceId, targetFolderId, readScopes },
    );
    return NextResponse.json({
      id: result.id,
      slug: result.slug,
      status: result.status,
      title: result.title,
      url: result.url,
      visibility: result.visibility,
    });
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json(
        { error: "limit_reached", dimension: err.dimension, limit: err.limit },
        { status: 402 },
      );
    }
    if (err instanceof ArtifactCreateError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "slug_conflict"
            ? 409
            : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}

// GET /api/artifacts — artifacts visible to the caller's read scopes, paginated.
// Mirrors artifactRouter.list for the CLI's Bearer credential paths; without it
// `deploy artifact create` needs the same enumerable slug interface as other deployments.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? undefined;

  const authz = await authorizeWorkspaceRequest(req, workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);

  const rawLimit = Number(params.get("limit"));
  const page = await listArtifactsForAccess(authz.access, {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined,
    cursor: params.get("cursor") ?? undefined,
  });
  return NextResponse.json(page);
}
