import { describe, expect, it } from "vitest";

import { harnessModelFor } from "./model";

// The pure render. Resolution (DB config + env) is covered in bindings.test.ts;
// this file must stay free of mocks — if it ever needs one, the module has
// picked up a cloud dependency it is not supposed to have.
describe("harnessModelFor", () => {
  it("gateway: passes the model id straight through to Pi", () => {
    expect(
      harnessModelFor({
        modelId: "anthropic/claude-sonnet-4.6",
        providerKind: "gateway",
      }),
    ).toEqual({
      modelId: "anthropic/claude-sonnet-4.6",
      pi: { model: "anthropic/claude-sonnet-4.6" },
    });
  });

  it("gateway: ignores a baseUrl and apiKey it does not need", () => {
    const model = harnessModelFor({
      modelId: "openai/gpt-5",
      providerKind: "gateway",
      baseUrl: "http://vllm.internal:8000/v1",
      apiKey: "sk-unused",
    });
    expect(model.pi).toEqual({ model: "openai/gpt-5" });
  });

  it("openai-compatible: registers a nimbase provider via customEnv", () => {
    expect(
      harnessModelFor({
        modelId: "qwen3-32b",
        providerKind: "openai-compatible",
        baseUrl: "http://vllm.internal:8000/v1",
        apiKey: "sk-self-hosted",
      }),
    ).toEqual({
      modelId: "qwen3-32b",
      pi: {
        model: "nimbase/qwen3-32b",
        auth: {
          customEnv: {
            NIMBASE_API_KEY: "sk-self-hosted",
            NIMBASE_BASE_URL: "http://vllm.internal:8000/v1",
          },
        },
      },
    });
  });

  it("openai-compatible: sends an empty key rather than undefined", () => {
    const model = harnessModelFor({
      modelId: "qwen3-32b",
      providerKind: "openai-compatible",
      baseUrl: "http://vllm.internal:8000/v1",
    });
    expect(model.pi.auth).toEqual({
      customEnv: {
        NIMBASE_API_KEY: "",
        NIMBASE_BASE_URL: "http://vllm.internal:8000/v1",
      },
    });
  });
});
