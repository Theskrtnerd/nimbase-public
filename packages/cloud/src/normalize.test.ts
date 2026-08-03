import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractBinaryText } from "./normalize";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveModels: vi.fn(),
}));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("./ai/resolve", () => ({ resolveModels: mocks.resolveModels }));

beforeEach(() => {
  mocks.resolveModels.mockResolvedValue({
    chat: {
      id: "anthropic/claude-sonnet-4.6",
      model: "anthropic/claude-sonnet-4.6",
    },
    normalize: {
      id: "google/gemini-2.5-flash",
      model: "google/gemini-2.5-flash",
    },
    embed: {
      id: "openai/text-embedding-3-small",
      model: "openai/text-embedding-3-small",
    },
  });
});

afterEach(() => vi.clearAllMocks());

interface GenerateTextCall {
  model: string;
  messages: {
    content: {
      type: string;
      mediaType?: string;
      data?: Uint8Array;
      text?: string;
    }[];
  }[];
}

describe("extractBinaryText", () => {
  it("sends the binary as a file part and maps text + usage", async () => {
    mocks.generateText.mockResolvedValue({
      text: "# Transcript\nhello",
      totalUsage: { inputTokens: 1200, outputTokens: 80 },
    });
    const data = new Uint8Array([1, 2, 3]);

    const result = await extractBinaryText({
      kind: "voice",
      mimeType: "audio/webm",
      data,
      workspaceId: "ws1",
    });

    expect(result.markdown).toBe("# Transcript\nhello");
    expect(result.modelId).toBe("google/gemini-2.5-flash");
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
    const call = mocks.generateText.mock.calls[0]?.[0] as GenerateTextCall;
    expect(call.model).toBe("google/gemini-2.5-flash");
    expect(call.messages[0]?.content[0]).toMatchObject({
      type: "file",
      mediaType: "audio/webm",
      data,
    });
  });

  it("uses the screenshot prompt for screenshots", async () => {
    mocks.generateText.mockResolvedValue({
      text: "ocr",
      totalUsage: { inputTokens: 1, outputTokens: 1 },
    });
    await extractBinaryText({
      kind: "screenshot",
      mimeType: "image/png",
      data: new Uint8Array(),
      workspaceId: "ws1",
    });
    const call = mocks.generateText.mock.calls[0]?.[0] as GenerateTextCall;
    const textPart = call.messages[0]?.content.find((p) => p.type === "text");
    expect(textPart?.text).toContain("screenshot");
  });
});
