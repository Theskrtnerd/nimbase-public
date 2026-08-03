import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  authorizeWorkspaceRequest: vi.fn(),
  registerRemoteConnector: vi.fn(),
  resolveTargetFolderPath: vi.fn(),
}));

vi.mock("@acme/api/connection-control", () => ({
  listConnectionsForAccess: vi.fn(),
}));
vi.mock("~/server/auth/authorize-workspace", () => ({
  authorizeWorkspaceRequest: mocks.authorizeWorkspaceRequest,
  authzErrorResponse: vi.fn(),
}));
vi.mock("~/server/crawl/port", () => ({
  crawlPort: { providers: () => [] },
}));
vi.mock("~/server/crawl/register", () => ({
  registerRemoteConnector: mocks.registerRemoteConnector,
}));
vi.mock("~/server/folders", () => ({
  resolveTargetFolderPath: mocks.resolveTargetFolderPath,
}));

const body = {
  workspaceId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
  endpointUrl: "https://connector.example",
  secret: null,
  displayName: null,
  targetFolderId: null,
  intervalSeconds: 86_400,
  configuration: {},
};

function request(): Request {
  return new Request("https://nimbase.example/api/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("connector registration authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTargetFolderPath.mockResolvedValue({ id: null, path: "" });
    mocks.registerRemoteConnector.mockResolvedValue({
      connectionId: "68998177-06af-4cc7-a20f-75539b86f61f",
      provider: "example/issues",
      label: "Example Issues",
      scopeKind: null,
      supportsScopes: false,
    });
  });

  it("rejects a capture-only member who cannot manage the target", async () => {
    mocks.authorizeWorkspaceRequest.mockResolvedValue({
      ok: true,
      workspaceId: body.workspaceId,
      userId: "user-1",
      access: { canManage: () => false },
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.registerRemoteConnector).not.toHaveBeenCalled();
  });

  it("registers a connector for a target manager", async () => {
    mocks.authorizeWorkspaceRequest.mockResolvedValue({
      ok: true,
      workspaceId: body.workspaceId,
      userId: "user-1",
      access: { canManage: () => true },
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.registerRemoteConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: body.workspaceId,
        endpointUrl: body.endpointUrl,
        userId: "user-1",
      }),
    );
  });
});
