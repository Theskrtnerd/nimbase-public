import type { ToolSet } from "ai";
import type { IFileSystem } from "just-bash";
import { createPi } from "@ai-sdk/harness-pi";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createJustBashSandbox } from "@ai-sdk/sandbox-just-bash";
import { InMemoryFs, MountableFs } from "just-bash";

import type { AgentName } from "@acme/agents";
import { agentDefinition } from "@acme/agents";

import type { HarnessModel } from "./model";
import type { WikiFileSystem } from "./wiki-file-system";

// Structural shape of the generation result a tracer records. Mirrors the
// telemetry module's own private type; declared here so this file needs no
// import from ../ai (see ./bindings.ts for why).
interface TracedGeneration {
  text?: string;
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Wraps one model call in an observation. Injected rather than imported: the
 * cloud implementation (Langfuse) is supplied by ./bindings.ts, and the
 * default below is a plain passthrough, so the runtime carries no telemetry
 * dependency of its own.
 */
export type HarnessTracer = <T extends TracedGeneration>(
  trace: {
    name: string;
    workspaceId?: string;
    role: string;
    modelId: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  },
  generate: () => Promise<T>,
) => Promise<T>;

const passthroughTracer: HarnessTracer = (_trace, generate) => generate();

export interface HarnessMounts {
  // The unified sandbox namespace: in-memory base (Pi work dir, /tmp, /output)
  // with the wiki mounted at /wiki.
  fs: MountableFs;
  // Read a file the agent wrote into the in-memory base (e.g. the artifact
  // artifact at /output/artifact.tsx). Returns null when absent.
  readOutput: (path: string) => Promise<string | null>;
}

export function buildHarnessMounts(wiki: WikiFileSystem): HarnessMounts {
  const fs = new MountableFs({
    base: new InMemoryFs(),
    mounts: [{ mountPoint: "/wiki", filesystem: wiki }],
  });
  return {
    fs,
    readOutput: async (path) => {
      try {
        return await fs.readFile(path);
      } catch {
        return null;
      }
    },
  };
}

export interface HarnessRunArgs {
  agent: AgentName;
  fs: IFileSystem;
  model: HarnessModel;
  // Host-executed custom tools (search + domain metadata tools).
  tools?: ToolSet;
  // Runtime context appended after the agent definition's instructions
  // (for example, company context and a fence line). Nulls are dropped.
  instructionsExtra?: (string | null)[];
  prompt: string;
  // Hard wall-clock cap. Pi owns its inner step loop, so this timeout (plus
  // spend tracking downstream) is the runaway guardrail.
  timeoutMs: number;
  trace: {
    name: string;
    workspaceId: string;
    metadata?: Record<string, unknown>;
  };
  // Defaults to a passthrough; ./bindings.ts supplies the Langfuse tracer.
  tracer?: HarnessTracer;
}

export interface HarnessRunResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

// One harness turn: build the Pi agent from the eve.dev-style definition,
// point its sandbox at the provided filesystem, run a single prompt, tear the
// session down. Session state is not reused — every job is a fresh session,
// mirroring how the legacy generateText loops were single-shot.
export async function runHarnessAgent(
  args: HarnessRunArgs,
): Promise<HarnessRunResult> {
  const def = agentDefinition(args.agent);
  const instructions = [def.instructions, ...(args.instructionsExtra ?? [])]
    .filter(Boolean)
    .join("\n\n");

  const agent = new HarnessAgent({
    harness: createPi(args.model.pi),
    sandbox: createJustBashSandbox({ fs: args.fs }),
    skills: def.skills,
    instructions,
    tools: args.tools ?? {},
  });

  const session = await agent.createSession();
  try {
    const result = await (args.tracer ?? passthroughTracer)(
      {
        name: `harness-${args.agent}`,
        workspaceId: args.trace.workspaceId,
        role: "chat",
        modelId: args.model.modelId,
        input: args.prompt,
        metadata: { harness: "pi", ...args.trace.metadata },
      },
      () =>
        agent.generate({
          session,
          prompt: args.prompt,
          abortSignal: AbortSignal.timeout(args.timeoutMs),
        }),
    );
    return {
      text: result.text,
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      },
    };
  } finally {
    await session.destroy();
  }
}
