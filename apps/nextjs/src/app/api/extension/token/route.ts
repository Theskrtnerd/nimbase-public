import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod/v4";

import { issueSessionToken, redeemAuthCode } from "~/lib/desktop-auth";

export const runtime = "nodejs";

// PKCE code redemption for the extension, on its own route so its TTL and
// revocation policy can diverge from other native clients later.
const Body = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(32).max(256),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const redeemed = redeemAuthCode(parsed);
  if (!redeemed) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(redeemed.userId);
  const session = issueSessionToken(redeemed.userId);

  return NextResponse.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress ?? null,
      name: user.fullName ?? user.username ?? null,
    },
  });
}
