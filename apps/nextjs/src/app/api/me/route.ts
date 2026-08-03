import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";

import { authorizeUserRequest } from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";

// GET /api/me — who the caller is. Same identity shape the login token exchange
// returns, so `nimbase auth whoami` can name the signed-in person instead of
// only confirming that *some* credential works.
//
// User sessions only: an ApiToken has no user behind it, and authorizeUserRequest
// deliberately does not accept one.
export async function GET(req: Request) {
  const userId = await authorizeUserRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return NextResponse.json({
    id: user.id,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    name: user.fullName ?? user.username ?? null,
  });
}
