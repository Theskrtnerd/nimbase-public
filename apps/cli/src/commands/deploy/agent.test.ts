import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerDeployAgent } from "./agent";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  requireSession: vi.fn(),
  resolveWorkspace: vi.fn(),
  workspaceScope: vi.fn(),
  connectDeployment: vi.fn(),
  printJson: vi.fn(),
  printLine: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../../context", () => ({ createContext: mocks.createContext }));
vi.mock("../../credentials", () => ({ requireSession: mocks.requireSession }));
vi.mock("../../workspace", () => ({
  resolveWorkspace: mocks.resolveWorkspace,
  workspaceScope: mocks.workspaceScope,
}));
vi.mock("../../deployment-oauth", () => ({
  connectDeployment: mocks.connectDeployment,
}));
vi.mock("../../output", () => ({
  printJson: mocks.printJson,
  printLine: mocks.printLine,
  renderTable: vi.fn(),
}));

describe("deploy agent create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createContext.mockResolvedValue({
      baseUrl: "https://app.nimbase.ai",
      config: {},
      globals: { json: false },
      client: { request: mocks.request },
    });
    mocks.resolveWorkspace.mockResolvedValue(
      "00000000-0000-4000-8000-000000000001",
    );
    mocks.request.mockResolvedValue({
      agentId: "00000000-0000-4000-8000-000000000002",
      deployment: {
        slug: "support",
        name: "Support",
        enabled: true,
        targetPath: "",
        targets: [
          {
            platform: "widget",
            status: "active",
            name: null,
            error: null,
            embed:
              '<script src="https://app.nimbase.ai/widget.js" data-widget-key="nb_wgt_public" async></script>',
          },
        ],
        instructions: "",
        targetFolderId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("creates a widget interface without starting OAuth", async () => {
    const program = new Command();
    registerDeployAgent(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "agent",
      "create",
      "Support",
      "--interface",
      "widget",
      "--slug",
      "customer-support",
    ]);

    const call = mocks.request.mock.calls[0] as unknown as [
      string,
      string,
      {
        body: {
          platform: string;
          slug?: string;
          instructions?: string;
          widget: { allowedDomains: string[] };
        };
      },
    ];
    expect(call[0]).toBe("POST");
    expect(call[1]).toBe("/api/deployments");
    expect(call[2].body.platform).toBe("widget");
    expect(call[2].body.slug).toBe("customer-support");
    expect(call[2].body).not.toHaveProperty("instructions");
    expect(call[2].body.widget).toEqual({
      allowedDomains: [],
    });
    expect(mocks.connectDeployment).not.toHaveBeenCalled();
    expect(mocks.printLine).toHaveBeenCalledWith("Embed:");
    expect(mocks.printLine).toHaveBeenCalledWith(
      expect.stringContaining("data-widget-key"),
    );
  });

  it("does not expose domain restrictions", () => {
    const program = new Command();
    registerDeployAgent(program);

    const create = program.commands[0]?.commands.find(
      (command) => command.name() === "create",
    );
    expect(create?.options.map((option) => option.long)).not.toContain(
      "--domain",
    );
  });
});
