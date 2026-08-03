import type { Command } from "commander";

import { saveConfig } from "../../config";
import { createContext } from "../../context";
import { printJson, printLine } from "../../output";
import { listWorkspaces, resolveWorkspaceSlug } from "../../workspace";

export function registerWorkspaceSelect(program: Command): void {
  program
    .command("list")
    .description("List your workspaces (the default is marked with *)")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      const workspaces = await listWorkspaces(ctx.client);
      if (ctx.globals.json) {
        printJson({
          workspaces: workspaces.map((workspace) => ({
            name: workspace.name,
            slug: workspace.slug,
            default: workspace.id === ctx.config.defaultWorkspaceId,
          })),
        });
        return;
      }
      if (workspaces.length === 0) {
        printLine("No workspaces.");
        return;
      }
      const defaultId = ctx.config.defaultWorkspaceId;
      for (const workspace of workspaces) {
        printLine(
          `${workspace.id === defaultId ? "*" : " "} ${workspace.slug}  ${workspace.name}`,
        );
      }
    });

  program
    .command("use")
    .description("Set the default workspace")
    .argument("<slug>", "workspace slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const ctx = await createContext(command);
      const workspace = await resolveWorkspaceSlug(ctx.client, slug);
      await saveConfig({
        ...ctx.config,
        defaultWorkspaceId: workspace.id,
      });
      if (ctx.globals.json) {
        printJson({
          ok: true,
          workspace: { name: workspace.name, slug: workspace.slug },
        });
      } else {
        printLine(`Workspace set to ${workspace.slug}`);
      }
    });
}
