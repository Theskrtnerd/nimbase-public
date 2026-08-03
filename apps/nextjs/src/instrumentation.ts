import { registerOTel } from "@vercel/otel";

import { langfuseBaseUrl } from "@acme/cloud";

import { env } from "~/env";

// Next.js instrumentation hook. Registers Langfuse's OpenTelemetry span
// processor so the "generation" observations created by `traceGeneration`
// (packages/cloud/src/ai/telemetry.ts) are exported to Langfuse. Dark by
// default: with no Langfuse keys set this returns without registering anything,
// so the app runs identically to today.
//
// AI SDK v7 no longer auto-emits OTel spans for generateText, so this pipeline
// only carries the spans we create explicitly via @langfuse/tracing — there is
// no dependency on the AI SDK's (removed) telemetry plumbing.
export async function register() {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return;

  // Tracing setup must never take down server boot: keys can be present but
  // still misconfigured (bad baseUrl, module resolution issues, etc.), and
  // that's a degraded-observability problem, not a reason to fail startup.
  try {
    // Imported lazily so the processor (and its OTel deps) never load when
    // tracing is off.
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");

    registerOTel({
      serviceName: "nimbase-nextjs",
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: langfuseBaseUrl(),
          // Next.js route handlers are short-lived; flush each span immediately so
          // traces aren't lost when the function is frozen between requests.
          exportMode: "immediate",
        }),
      ],
    });
  } catch (err) {
    console.error("instrumentation: Langfuse tracing setup failed", err);
  }
}
