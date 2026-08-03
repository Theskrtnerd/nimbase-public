import type { Command } from "commander";

import { registerDeployAgent } from "./agent";
import { registerDeployArtifact } from "./artifact";
import { registerDeployDocs } from "./docs";
import { registerDeployList } from "./list";
import { registerDeployMcp } from "./mcp";

export function registerDeploy(program: Command): void {
  const deploy = program
    .command("deploy")
    .description("Create and manage company-memory deployments");

  registerDeployList(deploy);
  registerDeployAgent(deploy);
  registerDeployArtifact(deploy);
  registerDeployDocs(deploy);
  registerDeployMcp(deploy);
}
