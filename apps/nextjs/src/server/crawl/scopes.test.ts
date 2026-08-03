import { beforeEach, describe, expect, it, vi } from "vitest";

import { configureConnectionScopes } from "./scopes";

const mocks = vi.hoisted(() => ({
  requireManageableConnection: vi.fn(),
  applyConnectionScopeConfiguration: vi.fn(),
  manifest: vi.fn(),
  scopes: vi.fn(),
}));

vi.mock("@acme/api/connection-control", () => ({
  ConnectionControlError: class ConnectionControlError extends Error {
    constructor(_code: string, message: string) {
      super(message);
    }
  },
  requireManageableConnection: mocks.requireManageableConnection,
  applyConnectionScopeConfiguration: mocks.applyConnectionScopeConfiguration,
}));
vi.mock("../connection-secret", () => ({
  decryptConnectionSecret: vi.fn(() => "connector-secret"),
}));
vi.mock("./registry", () => ({
  connectorAdapterFor: vi.fn(() => ({
    manifest: mocks.manifest,
    scopes: mocks.scopes,
  })),
}));

describe("connection scope control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManageableConnection.mockResolvedValue({
      id: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
      provider: "example/issues",
      connectorUrl: "https://connector.example",
      secretsEncrypted: "sealed",
      config: { scopeIds: ["team-1"] },
    });
    mocks.manifest.mockResolvedValue({
      protocolVersion: 1,
      id: "example/issues",
      label: "Example Issues",
      scopeKind: "team",
      supportsScopes: true,
    });
    mocks.scopes.mockResolvedValue({
      protocolVersion: 1,
      scopes: [
        { id: "team-1", name: "Platform" },
        { id: "team-2", name: "Product" },
      ],
    });
  });

  it("validates discovered scopes before storing generic scope ids", async () => {
    const result = await configureConnectionScopes({
      access: {} as Parameters<typeof configureConnectionScopes>[0]["access"],
      connectionId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
      scopeIds: ["team-2"],
    });

    expect(mocks.applyConnectionScopeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "example/issues" }),
      ["team-2"],
    );
    expect(result.scopes).toEqual([
      { id: "team-1", name: "Platform", selected: false },
      { id: "team-2", name: "Product", selected: true },
    ]);
  });

  it("rejects connector scope ids that were not discovered", async () => {
    await expect(
      configureConnectionScopes({
        access: {} as Parameters<typeof configureConnectionScopes>[0]["access"],
        connectionId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
        scopeIds: ["unknown"],
      }),
    ).rejects.toThrow("Unknown team unknown");
  });
});
