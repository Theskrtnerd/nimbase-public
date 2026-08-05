// The curated menu of selectable models. Adding a model (including a
// self-hosted one) is an edit here — role validity and gateway pricing have to
// be declared anyway, and the resolver/cost layers read from this single map.
export type AiRole = "chat" | "normalize" | "embed";

export interface ModelEntry {
  label: string;
  roles: AiRole[];
  // Gateway pricing, cents per million tokens. Embedding models bill input only.
  inputCentsPerMTok: number;
  outputCentsPerMTok: number;
  // Embedding output dimension; present only for embed-role models. The DB
  // column wiki_chunk.embedding is fixed at 1536, so embed stays global-only.
  dimensions?: number;
}

export const MODEL_REGISTRY = {
  "anthropic/claude-sonnet-4.6": {
    label: "Claude Sonnet 4.6",
    roles: ["chat"],
    inputCentsPerMTok: 300,
    outputCentsPerMTok: 1500,
  },
  "google/gemini-2.5-flash": {
    label: "Gemini 2.5 Flash",
    roles: ["chat", "normalize"],
    inputCentsPerMTok: 30,
    outputCentsPerMTok: 250,
  },
  "openai/text-embedding-3-small": {
    label: "OpenAI text-embedding-3-small",
    roles: ["embed"],
    inputCentsPerMTok: 2,
    outputCentsPerMTok: 0,
    dimensions: 1536,
  },
} as const satisfies Record<string, ModelEntry>;

export type RegisteredModelId = keyof typeof MODEL_REGISTRY;

// Code defaults — the floor of the resolution chain (workspace → global → here).
export const DEFAULT_MODELS = {
  chat: "anthropic/claude-sonnet-4.6",
  normalize: "google/gemini-2.5-flash",
  embed: "openai/text-embedding-3-small",
} as const;

// The selectable ids for a role, for settings dropdowns. The cast widens the
// `as const` literal `roles` tuples back to AiRole[] so `.includes` type-checks.
export function modelsForRole(role: AiRole): { id: string; label: string }[] {
  return Object.entries(MODEL_REGISTRY as Record<string, ModelEntry>)
    .filter(([, entry]) => entry.roles.includes(role))
    .map(([id, entry]) => ({ id, label: entry.label }));
}

// True when `id` is registered AND valid for `role`. Config writers gate on this.
export function isValidModelForRole(id: string, role: AiRole): boolean {
  const entry = (MODEL_REGISTRY as Record<string, ModelEntry>)[id];
  return Boolean(entry?.roles.includes(role));
}
