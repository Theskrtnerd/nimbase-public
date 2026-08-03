import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceCreatedSchema } from "@acme/validators/cli";

import { registerWorkspaceCreate } from "./create";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  resolveCredential: vi.fn(),
  login: vi.fn(),
  listWorkspaces: vi.fn(),
  saveConfig: vi.fn(),
  printJson: vi.fn(),
  printLine: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../../context", () => ({ createContext: mocks.createContext }));
vi.mock("../../credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));
vi.mock("../../login", () => ({ login: mocks.login }));
vi.mock("../../workspace", () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock("../../config", () => ({ saveConfig: mocks.saveConfig }));
vi.mock("../../output", () => ({
  printJson: mocks.printJson,
  printLine: mocks.printLine,
}));

describe("workspace creation output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCredential
      .mockReturnValueOnce({ mode: "none" })
      .mockReturnValueOnce({ mode: "session" });
    mocks.createContext.mockResolvedValue({
      baseUrl: "https://app.example.com",
      config: {},
      globals: { json: true },
      client: { request: mocks.request },
    });
    mocks.listWorkspaces.mockResolvedValue([]);
    mocks.request.mockResolvedValue({
      workspace: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "acme.example",
        slug: "acme-example",
        description: null,
        website: "https://acme.example",
        brainInitStatus: "pending",
      },
    });
  });

  it("keeps the login prompt off stdout before emitting one JSON result", async () => {
    const program = new Command().option("--json");
    registerWorkspaceCreate(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "--json",
      "create",
      "acme.example",
    ]);

    expect(mocks.login).toHaveBeenCalledWith("https://app.example.com");
    expect(mocks.request).toHaveBeenCalledWith("POST", "/api/workspaces", {
      body: { website: "https://acme.example" },
      schema: workspaceCreatedSchema,
    });
    expect(mocks.printLine).not.toHaveBeenCalled();
    expect(mocks.printJson).toHaveBeenCalledOnce();
    expect(mocks.printJson).toHaveBeenCalledWith(
      expect.objectContaining({ created: true }),
    );
  });

  it("accepts an explicit title and description when no website is available", async () => {
    mocks.createContext.mockResolvedValue({
      baseUrl: "https://app.example.com",
      config: {},
      globals: { json: false },
      client: { request: mocks.request },
    });
    const program = new Command();
    registerWorkspaceCreate(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "create",
      "--title",
      "Acme",
      "--description",
      "Acme builds anvils.",
    ]);

    expect(mocks.request).toHaveBeenCalledWith("POST", "/api/workspaces", {
      body: { title: "Acme", description: "Acme builds anvils." },
      schema: workspaceCreatedSchema,
    });
    expect(mocks.printLine).toHaveBeenCalledWith(
      "Nimbase is preparing company.md in the background.",
    );
  });

  it("explains that website identity is derived in the background", async () => {
    mocks.createContext.mockResolvedValue({
      baseUrl: "https://app.example.com",
      config: {},
      globals: { json: false },
      client: { request: mocks.request },
    });
    const program = new Command();
    registerWorkspaceCreate(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "create",
      "https://acme.example",
    ]);

    expect(mocks.printLine).toHaveBeenCalledWith(
      "Nimbase is enriching unspecified company identity from Context.dev, then preparing company.md.",
    );
  });

  it("requires both manual identity fields", async () => {
    const program = new Command();
    registerWorkspaceCreate(program);

    await expect(
      program.parseAsync(["node", "nimbase", "create", "--title", "Acme"]),
    ).rejects.toThrow("Provide a website");
    expect(mocks.createContext).not.toHaveBeenCalled();
  });

  it("uses explicit identity fields as overrides with a website", async () => {
    mocks.createContext.mockResolvedValue({
      baseUrl: "https://app.example.com",
      config: {},
      globals: { json: false },
      client: { request: mocks.request },
    });
    const program = new Command();
    registerWorkspaceCreate(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "create",
      "acme.example",
      "--title",
      "Acme",
      "--description",
      "Acme builds anvils.",
    ]);

    expect(mocks.request).toHaveBeenCalledWith("POST", "/api/workspaces", {
      body: {
        website: "https://acme.example",
        title: "Acme",
        description: "Acme builds anvils.",
      },
      schema: workspaceCreatedSchema,
    });
  });

  it("allows one explicit field to override website-derived identity", async () => {
    const program = new Command();
    registerWorkspaceCreate(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "create",
      "acme.example",
      "--title",
      "Acme",
    ]);

    expect(mocks.request).toHaveBeenCalledWith("POST", "/api/workspaces", {
      body: { website: "https://acme.example", title: "Acme" },
      schema: workspaceCreatedSchema,
    });
  });
});
