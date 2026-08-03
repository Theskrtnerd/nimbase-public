import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as WorkspaceAiConfigModule from "@acme/api/workspace-ai-config";

import { GET, PATCH } from "./route";

const mocks = vi.hoisted(() => ({
  authorizeWorkspaceRequest: vi.fn(),
  getWorkspaceAiConfig: vi.fn(),
  updateWorkspaceAiConfig: vi.fn(),
  workspaceChatModelOptions: vi.fn(),
}));

vi.mock("~/server/auth/authorize-workspace", () => ({
  authorizeWorkspaceRequest: mocks.authorizeWorkspaceRequest,
  authzErrorResponse: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  ),
}));

vi.mock("@acme/api/workspace-ai-config", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceAiConfigModule>();
  return {
    ...actual,
    getWorkspaceAiConfig: mocks.getWorkspaceAiConfig,
    updateWorkspaceAiConfig: mocks.updateWorkspaceAiConfig,
    workspaceChatModelOptions: mocks.workspaceChatModelOptions,
  };
});

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const AUTHORIZED = {
  ok: true,
  workspaceId: WORKSPACE_ID,
  userId: "user-1",
  access: { isAdmin: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeWorkspaceRequest.mockResolvedValue(AUTHORIZED);
  mocks.getWorkspaceAiConfig.mockResolvedValue({
    override: {
      chatModel: "google/gemini-2.5-flash",
      normalizeModel: null,
    },
    inherited: {
      chatModel: "anthropic/claude-sonnet-4.6",
      normalizeModel: "google/gemini-2.5-flash",
    },
  });
  mocks.workspaceChatModelOptions.mockReturnValue([
    {
      id: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
    },
  ]);
  mocks.updateWorkspaceAiConfig.mockResolvedValue(undefined);
});

describe("/api/workspaces/model", () => {
  it("returns the effective agent model to a workspace admin", async () => {
    const response = await GET(
      new Request(
        `https://app.test/api/workspaces/model?workspaceId=${WORKSPACE_ID}`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      modelId: "google/gemini-2.5-flash",
      workspaceOverride: "google/gemini-2.5-flash",
      source: "workspace",
    });
  });

  it("updates only the workspace chat model", async () => {
    const response = await PATCH(
      new Request("https://app.test/api/workspaces/model", {
        method: "PATCH",
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          modelId: "google/gemini-2.5-flash",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateWorkspaceAiConfig).toHaveBeenCalledWith(WORKSPACE_ID, {
      chatModel: "google/gemini-2.5-flash",
    });
  });

  it("rejects non-admin workspace members", async () => {
    mocks.authorizeWorkspaceRequest.mockResolvedValue({
      ...AUTHORIZED,
      access: { isAdmin: false },
    });

    const response = await GET(
      new Request(
        `https://app.test/api/workspaces/model?workspaceId=${WORKSPACE_ID}`,
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.getWorkspaceAiConfig).not.toHaveBeenCalled();
  });
});
