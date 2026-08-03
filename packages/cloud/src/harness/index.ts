// The Pi-harness AI runtime: wiki-as-filesystem sandbox, agent definitions
// (@acme/agents), and per-surface rollout flags.
export { harnessEnabledFor } from "./flags";
export type { HarnessSurface } from "./flags";
export { WikiFileSystem, deriveSummary } from "./wiki-file-system";
export { buildHarnessMounts } from "./run";
export type {
  HarnessMounts,
  HarnessRunArgs,
  HarnessRunResult,
  HarnessTracer,
} from "./run";
// These three are the cloud-bound variants: the pure forms in ./run, ./tools
// and ./model take the tracer / search / model selection as arguments, and
// ./bindings supplies the @acme/cloud implementations. Consumers see the same
// API as before.
export { kbSearchTool, resolveHarnessModel, runHarnessAgent } from "./bindings";
export { harnessModelFor } from "./model";
export type { HarnessModel, HarnessModelSelection } from "./model";
export { gardenerDomainTools } from "./tools";
export type { KbSearchFn, KbSearchHit } from "./tools";
export { runGardenerHarness } from "./gardener";
