import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { WorkspaceAiConfig } from "@acme/db/schema";
import {
  getGlobalConfig,
  isValidModelForRole,
  modelsForRole,
} from "@acme/runtime/ai";

export class WorkspaceAiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAiConfigError";
  }
}

type WorkspaceAiConfigUpdate =
  | {
      chatModel: string | null;
      normalizeModel?: string | null;
    }
  | {
      chatModel?: string | null;
      normalizeModel: string | null;
    };

export async function getWorkspaceAiConfig(workspaceId: string) {
  const [[row], global] = await Promise.all([
    db
      .select({
        chatModel: WorkspaceAiConfig.chatModel,
        normalizeModel: WorkspaceAiConfig.normalizeModel,
      })
      .from(WorkspaceAiConfig)
      .where(eq(WorkspaceAiConfig.workspaceId, workspaceId))
      .limit(1),
    getGlobalConfig(),
  ]);
  return {
    override: {
      chatModel: row?.chatModel ?? null,
      normalizeModel: row?.normalizeModel ?? null,
    },
    inherited: {
      chatModel: global.chatModel,
      normalizeModel: global.normalizeModel,
    },
  };
}

export async function updateWorkspaceAiConfig(
  workspaceId: string,
  input: WorkspaceAiConfigUpdate,
): Promise<void> {
  if (input.chatModel && !isValidModelForRole(input.chatModel, "chat")) {
    throw new WorkspaceAiConfigError(
      `Invalid chat model "${input.chatModel}". Available models: ${modelsForRole(
        "chat",
      )
        .map((model) => model.id)
        .join(", ")}`,
    );
  }
  if (
    input.normalizeModel &&
    !isValidModelForRole(input.normalizeModel, "normalize")
  ) {
    throw new WorkspaceAiConfigError(
      `Invalid normalize model "${input.normalizeModel}".`,
    );
  }

  const updatedAt = new Date();
  await db
    .insert(WorkspaceAiConfig)
    .values({
      workspaceId,
      chatModel: input.chatModel ?? null,
      normalizeModel: input.normalizeModel ?? null,
    })
    .onConflictDoUpdate({
      target: WorkspaceAiConfig.workspaceId,
      set: {
        ...(input.chatModel !== undefined
          ? { chatModel: input.chatModel }
          : {}),
        ...(input.normalizeModel !== undefined
          ? { normalizeModel: input.normalizeModel }
          : {}),
        updatedAt,
      },
    });
}

export function workspaceChatModelOptions() {
  return modelsForRole("chat");
}
