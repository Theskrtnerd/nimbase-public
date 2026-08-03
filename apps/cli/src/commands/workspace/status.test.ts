import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerWorkspaceStatus } from "./status";

const mocks = vi.hoisted(() => ({
  workspaceScope: vi.fn(),
  printJson: vi.fn(),
  printLine: vi.fn(),
  renderTable: vi.fn(() => "table"),
  request: vi.fn(),
}));

vi.mock("../../workspace", () => ({
  workspaceScope: mocks.workspaceScope,
}));
vi.mock("../../output", () => ({
  printJson: mocks.printJson,
  printLine: mocks.printLine,
  renderTable: mocks.renderTable,
}));

describe("workspace status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceScope.mockResolvedValue({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      ctx: {
        globals: { json: false },
        client: { request: mocks.request },
      },
    });
    mocks.request.mockResolvedValue({
      workspace: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Acme",
        slug: "acme",
        brainInitStatus: "ready",
      },
      plan: { id: "pro", status: "active" },
      memory: { compiled: 12 },
      captures: { total: 2, byStatus: { compiled: 2 } },
      connections: {
        total: 0,
        byStatus: {},
        incomplete: [],
        unhealthy: [],
      },
    });
  });

  it("shows the effective workspace plan and subscription status", async () => {
    const program = new Command();
    registerWorkspaceStatus(program);

    await program.parseAsync(["node", "nimbase", "status"]);

    expect(mocks.printLine).toHaveBeenCalledWith("Plan: pro (active)");
  });
});
