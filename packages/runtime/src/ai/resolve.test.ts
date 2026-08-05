import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveModels } from "./resolve";

const mocks = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  getWorkspaceOverride: vi.fn(),
}));

vi.mock("./config", () => ({
  getGlobalConfig: mocks.getGlobalConfig,
  getWorkspaceOverride: mocks.getWorkspaceOverride,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGlobalConfig.mockResolvedValue({
    providerKind: "gateway",
    baseUrl: "https://ai-gateway.vercel.sh",
    chatModel: "anthropic/claude-sonnet-4.6",
    normalizeModel: "google/gemini-2.5-flash",
    embedModel: "openai/text-embedding-3-small",
  });
  mocks.getWorkspaceOverride.mockResolvedValue({
    chatModel: null,
    normalizeModel: null,
  });
});

describe("resolveModels", () => {
  it("uses the global config when there is no workspace override", async () => {
    const r = await resolveModels("ws1");
    expect(r.chat.id).toBe("anthropic/claude-sonnet-4.6");
    // gateway provider passes the id straight through as the model handle.
    expect(r.chat.model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("lets a workspace override chat/normalize but keeps embed global", async () => {
    mocks.getWorkspaceOverride.mockResolvedValue({
      chatModel: "google/gemini-2.5-flash",
      normalizeModel: null,
    });
    const r = await resolveModels("ws1");
    expect(r.chat.id).toBe("google/gemini-2.5-flash");
    expect(r.normalize.id).toBe("google/gemini-2.5-flash");
    expect(r.embed.id).toBe("openai/text-embedding-3-small");
  });

  it("skips the workspace read when no workspaceId is given", async () => {
    const r = await resolveModels();
    expect(mocks.getWorkspaceOverride).not.toHaveBeenCalled();
    expect(r.chat.id).toBe("anthropic/claude-sonnet-4.6");
  });
});
