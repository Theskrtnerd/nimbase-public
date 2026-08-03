import type { Command } from "commander";

import { registerWorkspaceCreate } from "./create";
import { registerWorkspaceModel } from "./model";
import { registerWorkspacePlan } from "./plan";
import { registerWorkspaceSelect } from "./select";
import { registerWorkspaceStatus } from "./status";

export function registerWorkspace(program: Command): void {
  const workspace = program
    .command("workspace")
    .description("Create, select, configure, and inspect workspaces");

  registerWorkspaceCreate(workspace);
  registerWorkspaceModel(workspace);
  registerWorkspacePlan(workspace);
  registerWorkspaceSelect(workspace);
  registerWorkspaceStatus(workspace);
}
