import "server-only";

import { ConnectionControlError } from "@acme/api/connection-control";

export function connectionControlErrorResponse(
  error: unknown,
): Response | null {
  if (!(error instanceof ConnectionControlError)) return null;
  return Response.json(
    { error: error.message },
    { status: error.code === "not_found" ? 404 : 400 },
  );
}
