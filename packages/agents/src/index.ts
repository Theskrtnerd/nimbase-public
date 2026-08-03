import type { AgentDefinition } from "./codegen-core";
import { agentDefinitions } from "./generated";

export type {
  AgentDefinition,
  AgentDefinitions,
  AgentSkillDefinition,
  AgentSkillFile,
} from "./codegen-core";

export type AgentName = "biographer" | "artifact" | "chat" | "gardener";

// The eve.dev-style agent definitions (instructions + skills), embedded at
// codegen time from definitions/<name>/. Throwing on an unknown name keeps a
// renamed directory from silently shipping an agent with no prompt.
export function agentDefinition(name: AgentName): AgentDefinition {
  const def = agentDefinitions[name];
  if (!def) throw new Error(`unknown agent definition "${name}"`);
  return def;
}
