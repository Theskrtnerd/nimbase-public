import type { Command } from "commander";

import { workspaceModelConfigSchema } from "@acme/validators/cli";

import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { usageError } from "../../errors";
import { printJson, printLine, renderTable } from "../../output";
import { resolveWorkspace } from "../../workspace";

interface ModelOptions {
  inherit: boolean;
}

export function registerWorkspaceModel(program: Command): void {
  program
    .command("model")
    .description("Show or change the default model used by deployed agents")
    .argument("[model-id]", "registered chat model id")
    .option("--inherit", "remove the override and inherit the global default")
    .action(
      async (
        modelId: string | undefined,
        options: ModelOptions,
        command: Command,
      ) => {
        if (modelId && options.inherit) {
          throw usageError("Pass a model id or --inherit, not both.");
        }

        const ctx = await createContext(command);
        requireSession(ctx.config, "`nimbase workspace model`");
        const workspaceId = await resolveWorkspace(ctx);
        const config =
          modelId || options.inherit
            ? await ctx.client.request("PATCH", "/api/workspaces/model", {
                body: {
                  workspaceId,
                  modelId: options.inherit ? null : modelId,
                },
                schema: workspaceModelConfigSchema,
              })
            : await ctx.client.request("GET", "/api/workspaces/model", {
                query: { workspaceId },
                schema: workspaceModelConfigSchema,
              });

        if (ctx.globals.json) {
          printJson(config);
          return;
        }
        if (modelId) {
          printLine(`Workspace agent model set to ${config.modelId}.`);
          printLine("All deployed agents will use it on their next turn.");
          return;
        }
        if (options.inherit) {
          printLine(
            `Workspace agent model now inherits the global default (${config.modelId}).`,
          );
          return;
        }

        printLine(
          `Agent model: ${config.modelId} (${config.source === "workspace" ? "workspace override" : "global default"})`,
        );
        printLine("Available models:");
        printLine(
          renderTable(config.availableModels, [
            { key: "id", header: "MODEL ID" },
            { key: "label", header: "NAME" },
          ]),
        );
      },
    );
}
