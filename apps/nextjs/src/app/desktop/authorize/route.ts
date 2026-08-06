import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { isAllowedRedirect } from "~/lib/allowed-redirect";
import { issueAuthCode } from "~/lib/desktop-auth";

const DEFAULT_REDIRECT = "nimbase://auth/callback";

// PKCE authorization for native clients, including the CLI. Authentication is
// hosted by Clerk; this route only exchanges the authenticated browser session
// for a one-time code and immediately returns control to the native client.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  const redirectBase = url.searchParams.get("redirect") ?? DEFAULT_REDIRECT;

  if (!challenge || !state) {
    return new Response("Missing authorization parameters\n", { status: 400 });
  }
  if (!isAllowedRedirect(redirectBase)) {
    return new Response("Invalid native redirect\n", { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) {
    return new Response("Authentication required\n", { status: 401 });
  }

  const code = issueAuthCode({ userId, challenge, state });
  const callback = new URL(redirectBase);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return NextResponse.redirect(callback);
}
