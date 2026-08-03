import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod/v4";

const uuid = z.uuid();

/**
 * Whether a dynamic route param is UUID-shaped.
 *
 * Postgres raises `invalid input syntax for uuid` when a malformed id reaches a
 * uuid column, which escaped as an opaque 500 ("Request failed (500)" in the
 * CLI) and as noise in error tracking. Routes whose `[id]` is a UUID check it
 * here first so a bad id is a 400 the caller can act on.
 */
export function isUuidParam(value: string): boolean {
  return uuid.safeParse(value).success;
}

/** JSON 400 for a malformed id, for API routes. */
export function invalidIdResponse(): NextResponse {
  return NextResponse.json({ error: "invalid_id" }, { status: 400 });
}

/** Plain-text 400 for the browser-facing surfaces (previews, raw redirects). */
export function invalidIdTextResponse(): Response {
  return new Response("Invalid id", { status: 400 });
}
