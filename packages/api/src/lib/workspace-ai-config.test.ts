import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWorkspaceAiConfig,
  updateWorkspaceAiConfig,
  WorkspaceAiConfigError,
} from "./workspace-ai-config";

const mocks = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  isValidModelForRole: vi.fn(),
  modelsForRole: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  insertedValues: vi.fn(),
  conflictUpdate: vi.fn(),
}));

vi.mock("@acme/runtime/ai", () => ({
  getGlobalConfig: mocks.getGlobalConfig,
  isValidModelForRole: mocks.isValidModelForRole,
  modelsForRole: mocks.modelsForRole,
}));

vi.mock("@acme/db/client", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
}));

describe("workspace AI config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGlobalConfig.mockResolvedValue({
      chatModel: "anthropic/claude-sonnet-4.6",
      normalizeModel: "google/gemini-2.5-flash",
    });
    mocks.isValidModelForRole.mockReturnValue(true);
    mocks.modelsForRole.mockReturnValue([
      {
        id: "anthropic/claude-sonnet-4.6",
        label: "Claude Sonnet 4.6",
      },
    ]);
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                chatModel: "google/gemini-2.5-flash",
                normalizeModel: null,
              },
            ]),
        }),
      }),
    });
    mocks.insert.mockReturnValue({
      values: mocks.insertedValues.mockReturnValue({
        onConflictDoUpdate: mocks.conflictUpdate.mockResolvedValue(undefined),
      }),
    });
  });

  it("returns workspace overrides alongside their inherited defaults", async () => {
    await expect(getWorkspaceAiConfig("ws-1")).resolves.toEqual({
      override: {
        chatModel: "google/gemini-2.5-flash",
        normalizeModel: null,
      },
      inherited: {
        chatModel: "anthropic/claude-sonnet-4.6",
        normalizeModel: "google/gemini-2.5-flash",
      },
    });
  });

  it("updates only the chat override without clearing normalize", async () => {
    await updateWorkspaceAiConfig("ws-1", {
      chatModel: "google/gemini-2.5-flash",
    });

    const update = mocks.conflictUpdate.mock.calls[0]?.[0] as unknown as {
      target: unknown;
      set: {
        chatModel: string;
        updatedAt: Date;
        normalizeModel?: string | null;
      };
    };
    expect(update.target).toBeDefined();
    expect(update.set.chatModel).toBe("google/gemini-2.5-flash");
    expect(update.set.updatedAt).toBeInstanceOf(Date);
    expect(update.set).not.toHaveProperty("normalizeModel");
  });

  it("rejects an unregistered chat model before writing", async () => {
    mocks.isValidModelForRole.mockReturnValue(false);

    await expect(
      updateWorkspaceAiConfig("ws-1", {
        chatModel: "unregistered/model",
      }),
    ).rejects.toBeInstanceOf(WorkspaceAiConfigError);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
