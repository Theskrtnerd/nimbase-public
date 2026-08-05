import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHarnessModel } from "./bindings";

const mocks = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  getWorkspaceOverride: vi.fn(),
  cloudEnv: vi.fn(),
}));

vi.mock("../ai/config", () => ({
  getGlobalConfig: mocks.getGlobalConfig,
  getWorkspaceOverride: mocks.getWorkspaceOverride,
}));
vi.mock("../env", () => ({ cloudEnv: mocks.cloudEnv }));

describe("resolveHarnessModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudEnv.mockReturnValue({ NIMBASE_AI_API_KEY: "sk-self-hosted" });
    mocks.getWorkspaceOverride.mockResolvedValue({
      chatModel: null,
      normalizeModel: null,
    });
    mocks.getGlobalConfig.mockResolvedValue({
      providerKind: "gateway",
      baseUrl: "https://ai-gateway.vercel.sh",
      chatModel: "anthropic/claude-sonnet-4.6",
    });
  });

  it("gateway: passes the model id straight through to Pi", async () => {
    const model = await resolveHarnessModel("ws-1");
    expect(model).toEqual({
      modelId: "anthropic/claude-sonnet-4.6",
      pi: { model: "anthropic/claude-sonnet-4.6" },
    });
  });

  it("workspace override takes precedence over the global chat model", async () => {
    mocks.getWorkspaceOverride.mockResolvedValue({
      chatModel: "openai/gpt-5",
      normalizeModel: null,
    });
    const model = await resolveHarnessModel("ws-1");
    expect(model.modelId).toBe("openai/gpt-5");
    expect(model.pi.model).toBe("openai/gpt-5");
  });

  it("openai-compatible: registers a nimbase provider via customEnv", async () => {
    mocks.getGlobalConfig.mockResolvedValue({
      providerKind: "openai-compatible",
      baseUrl: "http://vllm.internal:8000/v1",
      chatModel: "qwen3-32b",
    });
    const model = await resolveHarnessModel("ws-1");
    expect(model.modelId).toBe("qwen3-32b");
    expect(model.pi).toEqual({
      model: "nimbase/qwen3-32b",
      auth: {
        customEnv: {
          NIMBASE_API_KEY: "sk-self-hosted",
          NIMBASE_BASE_URL: "http://vllm.internal:8000/v1",
        },
      },
    });
  });
});
