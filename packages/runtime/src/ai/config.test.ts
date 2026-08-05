import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGlobalConfig, invalidateGlobalConfig } from "./config";

const mocks = vi.hoisted(() => ({ aiEnv: vi.fn(), select: vi.fn() }));

vi.mock("@acme/db/client", () => ({
  db: { select: mocks.select },
}));
vi.mock("../env", () => ({ aiEnv: mocks.aiEnv }));

beforeEach(() => {
  vi.clearAllMocks();
  invalidateGlobalConfig();
});

describe("environment AI configuration", () => {
  it("boots a fresh install without reading ai_config", async () => {
    mocks.aiEnv.mockReturnValue({
      NIMBASE_AI_PROVIDER: "openai-compatible",
      NIMBASE_AI_BASE_URL: "http://localhost:11434/v1",
      NIMBASE_AI_CHAT_MODEL: "local-chat",
      NIMBASE_AI_NORMALIZE_MODEL: "local-chat",
      NIMBASE_AI_EMBED_MODEL: "local-embed",
    });

    await expect(getGlobalConfig()).resolves.toEqual({
      providerKind: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      chatModel: "local-chat",
      normalizeModel: "local-chat",
      embedModel: "local-embed",
    });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects an incomplete override", async () => {
    mocks.aiEnv.mockReturnValue({
      NIMBASE_AI_PROVIDER: "openai-compatible",
    });

    await expect(getGlobalConfig()).rejects.toThrow(
      "NIMBASE_AI_PROVIDER requires",
    );
  });
});
