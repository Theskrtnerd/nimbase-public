import { NextResponse } from "next/server";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { invalidIdResponse, isUuidParam } from "~/server/http/params";
import { getNoteForAccess } from "~/server/kb/get-note";

export const runtime = "nodejs";

// get_note: full markdown body for one compiled note. Mirrors kb.getNode but
// authorizes via authorizeWorkspaceRequest so it works for the CLI's session
// token and ApiToken credentials alike.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuidParam(id)) return invalidIdResponse();
  const workspaceId =
    new URL(req.url).searchParams.get("workspaceId") ?? undefined;

  const authz = await authorizeWorkspaceRequest(req, workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);

  const note = await getNoteForAccess(authz.access, id);
  // NOT_FOUND (not FORBIDDEN): invisible notes must not reveal their existence.
  if (!note) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(note);
}
