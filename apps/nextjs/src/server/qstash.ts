import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

type AppRouteHandler = (request: Request) => Promise<Response>;

// verifySignatureAppRouter constructs a QStash Receiver eagerly, which
// throws if QSTASH_CURRENT_SIGNING_KEY/QSTASH_NEXT_SIGNING_KEY are unset.
// Calling it at module scope means `next build` crashes while collecting
// page data in any environment without those keys configured, even though
// the route is never invoked there (QStash itself is unconfigured). Deferring
// construction to the first request keeps the build green while preserving
// signature verification whenever the route actually runs.
export function verifyQstashSignature(
  handler: AppRouteHandler,
): AppRouteHandler {
  let verified: AppRouteHandler | undefined;
  return (request) => {
    verified ??= verifySignatureAppRouter(handler);
    return verified(request);
  };
}
