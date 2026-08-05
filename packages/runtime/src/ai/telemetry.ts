// Langfuse LLM tracing helper. AI SDK v7 no longer emits OpenTelemetry spans
// for generateText/streamText, so we can't rely on `experimental_telemetry` +
// an OTel exporter to observe model calls. Instead each call site wraps its
// generateText in `traceGeneration`, which creates an explicit Langfuse
// "generation" observation (via @langfuse/tracing) recording the model, input,
// output, and token usage. The spans are exported by the LangfuseSpanProcessor
// registered in the Next.js instrumentation hook.
//
// Tracing is dark by default: when the Langfuse keys are absent
// `traceGeneration` just runs the call with zero tracing overhead. Reads
// process.env directly (not cloudEnv()) so importing this in a context missing
// unrelated required vars never throws.

export const LANGFUSE_CLOUD_BASE_URL = "https://cloud.langfuse.com";

export interface GenerationTrace {
  // Observation name shown in Langfuse (e.g. "artifact-generate").
  name: string;
  workspaceId?: string;
  role: string;
  modelId: string;
  // The prompt/messages sent to the model, recorded as the generation input.
  input?: unknown;
  metadata?: Record<string, unknown>;
}

// Structural shape of the AI SDK's generateText result that we record. Kept
// structural (not an `ai` import) so @acme/runtime doesn't take a dependency on
// the AI SDK just for tracing.
interface GenerationResult {
  text?: string;
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export function langfuseEnabled(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );
}

export function langfuseBaseUrl(): string {
  return process.env.LANGFUSE_BASE_URL ?? LANGFUSE_CLOUD_BASE_URL;
}

function traceMetadata(trace: GenerationTrace): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    role: trace.role,
    ...trace.metadata,
  };
  if (trace.workspaceId) metadata.workspaceId = trace.workspaceId;
  return metadata;
}

// Langfuse reads `input`/`output`/`total` as its canonical usage keys.
function usageDetails(
  usage: GenerationResult["totalUsage"],
): Record<string, number> | undefined {
  if (!usage) return undefined;
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    total:
      usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
  };
}

/**
 * Run `generate` (an AI SDK generateText call) wrapped in a Langfuse
 * "generation" observation recording the model, input, output text, and token
 * usage. When Langfuse isn't configured this is a passthrough — `generate` runs
 * with no tracing and no extra imports loaded.
 */
export async function traceGeneration<T extends GenerationResult>(
  trace: GenerationTrace,
  generate: () => Promise<T>,
): Promise<T> {
  if (!langfuseEnabled()) return generate();

  // Imported lazily so @langfuse/tracing (and OTel) never load when tracing is
  // off.
  const { startActiveObservation } = await import("@langfuse/tracing");

  return startActiveObservation(
    trace.name,
    async (generation) => {
      generation.update({
        model: trace.modelId,
        input: trace.input,
        metadata: traceMetadata(trace),
      });
      const result = await generate();
      generation.update({
        output: result.text,
        usageDetails: usageDetails(result.totalUsage),
      });
      return result;
    },
    { asType: "generation" },
  );
}
