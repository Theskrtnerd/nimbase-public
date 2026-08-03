import { NextResponse } from "next/server";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { listSourcesForAccess } from "~/server/kb/list-sources";

export const runtime = "nodejs";

// Newest sources visible to the caller's read scopes, paginated. Used by the
// CLI `memory captures list`.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? undefined;
  const authz = await authorizeWorkspaceRequest(req, workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);

  // A non-numeric `limit` falls back to the default rather than 400ing — the
  // page size is a preference, not part of the request's meaning.
  const rawLimit = Number(params.get("limit"));
  const page = await listSourcesForAccess(authz.access, {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined,
    cursor: params.get("cursor") ?? undefined,
  });
  return NextResponse.json(page);
}
