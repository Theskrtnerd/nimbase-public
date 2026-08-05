import { setLangfuseTracerProvider } from "@langfuse/tracing";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { traceGeneration } from "./telemetry";

// Prove tracing actually produces a Langfuse generation span, end-to-end,
// without live Langfuse credentials: we point @langfuse/tracing at an in-memory
// OTel provider and inspect the exported span. This is the only way to catch a
// regression back to the old no-op behavior (where nothing was ever emitted).
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

describe("traceGeneration", () => {
  const prevPublic = process.env.LANGFUSE_PUBLIC_KEY;
  const prevSecret = process.env.LANGFUSE_SECRET_KEY;

  beforeAll(() => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    setLangfuseTracerProvider(provider);
  });

  afterAll(() => {
    setLangfuseTracerProvider(null);
    process.env.LANGFUSE_PUBLIC_KEY = prevPublic;
    process.env.LANGFUSE_SECRET_KEY = prevSecret;
  });

  beforeEach(() => {
    exporter.reset();
  });

  it("exports a generation span with model, input, output and usage", async () => {
    const result = await traceGeneration(
      {
        name: "artifact-generate",
        workspaceId: "ws-1",
        role: "chat",
        modelId: "anthropic/claude-sonnet-4.6",
        input: "make me a dashboard",
        metadata: { artifactId: "c-1" },
      },
      () =>
        Promise.resolve({
          text: "<html>ok</html>",
          totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }),
    );

    expect(result.text).toBe("<html>ok</html>");

    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    const [span] = spans;
    expect(span?.name).toBe("artifact-generate");

    // Attribute key names are Langfuse-internal; assert the payload carries the
    // values we recorded rather than pinning exact keys.
    const attrs = JSON.stringify(span?.attributes);
    expect(attrs).toContain("anthropic/claude-sonnet-4.6");
    expect(attrs).toContain("make me a dashboard");
    expect(attrs).toContain("<html>ok</html>");
    expect(attrs).toContain("ws-1");
  });

  it("is a passthrough (no span) when Langfuse keys are absent", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    try {
      const result = await traceGeneration(
        { name: "compile-gardener", role: "chat", modelId: "m" },
        () => Promise.resolve({ text: "done" }),
      );
      expect(result.text).toBe("done");
      await provider.forceFlush();
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    } finally {
      process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
      process.env.LANGFUSE_SECRET_KEY = "sk-test";
    }
  });
});
