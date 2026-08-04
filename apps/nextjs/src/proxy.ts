import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

import { env } from "~/env";

// Inverse model: only routes matched here require a Clerk session. Everything
// else (including signed QStash jobs and public pages) stays public and
// self-authorizes in its handler.
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/desktop(.*)"]);

// Map mcp.<appHost>/<org>/<group>/mcp → /api/group-mcp/<org>/<group>. Returns
// null when the host isn't the dedicated MCP subdomain or the path isn't a group
// MCP URL. A single fixed subdomain (not a wildcard) keeps DNS/TLS simple — one
// ordinary CNAME to Vercel, no wildcard cert or nameserver delegation — and the
// trailing /mcp matches the MCP streamable-HTTP convention.
export function groupMcpRewritePath(
  host: string,
  pathname: string,
  appHost: string,
): string | null {
  const bare = host.split(":")[0] ?? "";
  if (bare !== `mcp.${appHost}`) return null;
  const m =
    /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/mcp\/?$/.exec(
      pathname,
    );
  if (!m?.[1] || !m[2]) return null;
  return `/api/group-mcp/${m[1]}/${m[2]}`;
}

export default clerkMiddleware(async (auth, req) => {
  const appHost = env.NEXT_PUBLIC_APP_HOST ?? "nimbase.ai";
  const rewrite = groupMcpRewritePath(
    req.headers.get("host") ?? "",
    req.nextUrl.pathname,
    appHost,
  );
  if (rewrite) {
    const url = req.nextUrl.clone();
    url.pathname = rewrite;
    return NextResponse.rewrite(url);
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
