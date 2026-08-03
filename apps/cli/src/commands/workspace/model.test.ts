import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerWorkspaceModel } from "./model";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  requireSession: vi.fn(),
  resolveWorkspace: vi.fn(),
  printJson: vi.fn(),
  printLine: vi.fn(),
  renderTable: vi.fn(() => "model table"),
  request: vi.fn(),
}));

vi.mock("../../context", () => ({ createContext: mocks.createContext }));
vi.mock("../../credentials", () => ({ requireSession: mocks.requireSession }));
vi.mock("../../workspace", () => ({
  resolveWorkspace: mocks.resolveWorkspace,
}));
vi.mock("../../output", () => ({
  printJson: mocks.printJson,
  printLine: mocks.printLine,
  renderTable: mocks.renderTable,
}));

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const CONFIG = {
  modelId: "google/gemini-2.5-flash",
  workspaceOverride: "google/gemini-2.5-flash",
  source: "workspace",
  availableModels: [
    {
      id: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
    },
  ],
};

describe("workspace model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createContext.mockResolvedValue({
      config: {},
      globals: { json: false },
      client: { request: mocks.request },
    });
    mocks.resolveWorkspace.mockResolvedValue(WORKSPACE_ID);
    mocks.request.mockResolvedValue(CONFIG);
  });

  it("sets the workspace model inherited by deployed agents", async () => {
    const program = new Command();
    registerWorkspaceModel(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "model",
      "google/gemini-2.5-flash",
    ]);

    expect(mocks.request).toHaveBeenCalledWith(
      "PATCH",
      "/api/workspaces/model",
      expect.objectContaining({
        body: {
          workspaceId: WORKSPACE_ID,
          modelId: "google/gemini-2.5-flash",
        },
      }),
    );
    expect(mocks.printLine).toHaveBeenCalledWith(
      "All deployed agents will use it on their next turn.",
    );
  });

  it("shows the effective model and available choices without changing it", async () => {
    const program = new Command();
    registerWorkspaceModel(program);

    await program.parseAsync(["node", "nimbase", "model"]);

    expect(mocks.request).toHaveBeenCalledWith(
      "GET",
      "/api/workspaces/model",
      expect.objectContaining({ query: { workspaceId: WORKSPACE_ID } }),
    );
    expect(mocks.renderTable).toHaveBeenCalledWith(
      CONFIG.availableModels,
      expect.any(Array),
    );
  });

  it("can return the workspace to the global default", async () => {
    mocks.request.mockResolvedValue({
      ...CONFIG,
      workspaceOverride: null,
      source: "global",
    });
    const program = new Command();
    registerWorkspaceModel(program);

    await program.parseAsync(["node", "nimbase", "model", "--inherit"]);

    expect(mocks.request).toHaveBeenCalledWith(
      "PATCH",
      "/api/workspaces/model",
      expect.objectContaining({
        body: { workspaceId: WORKSPACE_ID, modelId: null },
      }),
    );
  });

  it("rejects a model id combined with --inherit", async () => {
    const program = new Command();
    registerWorkspaceModel(program);

    await expect(
      program.parseAsync([
        "node",
        "nimbase",
        "model",
        "google/gemini-2.5-flash",
        "--inherit",
      ]),
    ).rejects.toThrow("Pass a model id or --inherit, not both.");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
