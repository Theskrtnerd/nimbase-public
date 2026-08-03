import { NextResponse } from "next/server";
import { z } from "zod/v4";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";
import { createPortalSession } from "~/server/billing/stripe";

export const runtime = "nodejs";

const Body = z.object({ workspaceId: z.uuid() });

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const authz = await authorizeWorkspaceRequest(req, body.workspaceId);
  if (!authz.ok) return authzErrorResponse(authz);
  // Owner-only, and only via a real user session (ApiTokens act as "member").
  if (authz.access.role !== "owner" || !authz.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { url } = await createPortalSession({
      workspaceId: authz.workspaceId,
      baseUrl: new URL(req.url).origin,
    });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing/portal] failed", err);
    return NextResponse.json({ error: "portal_failed" }, { status: 500 });
  }
}
