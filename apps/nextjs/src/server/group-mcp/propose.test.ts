import { describe, expect, it, vi } from "vitest";

import { proposeGroupMcpFromPrompt } from "./propose";

vi.mock("@acme/cloud", () => ({
  resolveModels: vi.fn(() => Promise.resolve({ chat: { id: "m", model: {} } })),
  traceGeneration: vi.fn((_m: unknown, run: () => unknown) => run()),
  costFor: vi.fn(() => 0),
}));
vi.mock("@acme/cloud/memory/wiki", () => ({
  WikiReadFs: class {},
  readTools: () => ({}),
}));
vi.mock("ai", () => ({
  generateText: vi.fn(() =>
    Promise.resolve({
      text: JSON.stringify({
        name: "Design Team",
        slug: "Design Team",
        instructions: "Design specs and brand guidelines.",
        folderPath: "design",
        tools: ["search", "get_note"],
      }),
    }),
  ),
  isStepCount: () => false,
}));

describe("proposeGroupMcpFromPrompt", () => {
  it("returns a normalized proposal", async () => {
    const p = await proposeGroupMcpFromPrompt({
      workspaceId: "ws-1",
      prompt: "An MCP for the design team",
      readScopes: null,
    });
    expect(p.slug).toBe("design-team"); // normalized from the model's loose value
    expect(p.tools).toContain("search");
    expect(p.folderPath).toBe("design");
    expect(p.instructions).toContain("Design specs");
  });
});
