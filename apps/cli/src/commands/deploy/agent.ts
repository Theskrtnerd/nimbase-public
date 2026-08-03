import type { Command } from "commander";

import type {
  DeploymentDetail,
  DeploymentPlatform,
  DeploymentSummary,
} from "@acme/validators/cli";
import {
  deploymentCreatedSchema,
  deploymentDetailSchema,
  deploymentPlatformSchema,
  deploymentsResponseSchema,
} from "@acme/validators/cli";

import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { connectDeployment } from "../../deployment-oauth";
import { CliError, usageError } from "../../errors";
import { printJson, printLine, renderTable } from "../../output";
import { resolveWorkspace, workspaceScope } from "../../workspace";

interface CreateFlags {
  interface: string;
  slug?: string;
  folder?: string;
  open: boolean;
}

type InterfaceRequest =
  | { platform: "slack" }
  | { platform: "widget"; widget: { allowedDomains: string[] } };

export function registerDeployAgent(program: Command): void {
  const agent = program
    .command("agent")
    .description("Create and manage agents and their interfaces");

  agent
    .command("create")
    .description(
      "Create an agent from a prompt and deploy it through an interface",
    )
    .argument("<prompt>", "what to deploy")
    .requiredOption(
      "--interface <interface>",
      deploymentPlatformSchema.options.join(" | "),
    )
    .option("--slug <slug>", "stable agent identifier")
    .option("--folder <uuid>", "knowledge anchor folder id (omit for root)")
    .option("--no-open", "for OAuth interfaces, print URL without opening")
    .action(async (prompt: string, options: CreateFlags, command: Command) => {
      const platform = deploymentPlatformSchema.safeParse(options.interface);
      if (!platform.success) {
        throw usageError(
          `interface must be one of: ${deploymentPlatformSchema.options.join(", ")}`,
        );
      }
      const interfaceRequest = parseInterfaceRequest(platform.data);

      const ctx = await createContext(command);
      requireSession(ctx.config, "`nimbase deploy agent create`");
      const workspaceId = await resolveWorkspace(ctx);
      const created = await ctx.client.request("POST", "/api/deployments", {
        body: {
          workspaceId,
          slug: options.slug,
          name: prompt,
          targetFolderId: options.folder,
          ...interfaceRequest,
        },
        schema: deploymentCreatedSchema,
      });
      if (interfaceRequest.platform === "slack") {
        const slug = await connectDeployment({
          baseUrl: ctx.baseUrl,
          agentId: created.agentId,
          slug: created.deployment.slug,
          platform: interfaceRequest.platform,
          open: options.open,
        });
        if (slug !== created.deployment.slug) {
          throw new CliError("Deployment callback did not match", 1);
        }
      }

      if (ctx.globals.json) {
        printJson({
          deployment: created.deployment,
          interface: interfaceRequest.platform,
        });
      } else {
        printLine(
          `Deployed ${created.deployment.slug} through ${interfaceRequest.platform}.`,
        );
        const embed = created.deployment.targets.find(
          (target) => target.platform === "widget",
        )?.embed;
        if (embed) {
          printLine("Embed:");
          printLine(embed);
        }
        printLine(
          `Inspect it with \`nimbase deploy agent get ${created.deployment.slug}\`.`,
        );
      }
    });

  agent
    .command("list")
    .description("List agent deployments")
    .action(async (_options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const response = await ctx.client.request("GET", "/api/deployments", {
        query: { workspaceId },
        schema: deploymentsResponseSchema,
      });
      if (ctx.globals.json) {
        printJson(response);
        return;
      }
      printDeployments(response.deployments);
    });

  agent
    .command("get")
    .description("Inspect an agent deployment")
    .argument("<slug>", "deployment slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const deployment = await ctx.client.request(
        "GET",
        `/api/deployments/${encodeURIComponent(slug)}`,
        {
          query: { workspaceId },
          schema: deploymentDetailSchema,
        },
      );
      if (ctx.globals.json) {
        printJson(deployment);
        return;
      }
      printDeployment(deployment);
    });

  agent
    .command("remove")
    .description("Delete an agent deployment and revoke all its targets")
    .argument("<slug>", "deployment slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      await ctx.client.request(
        "DELETE",
        `/api/deployments/${encodeURIComponent(slug)}`,
        { query: { workspaceId } },
      );
      if (ctx.globals.json) {
        printJson({ ok: true, slug });
      } else {
        printLine(`Undeployed ${slug}.`);
      }
    });
}

function printDeployments(deployments: DeploymentSummary[]): void {
  if (deployments.length === 0) {
    printLine("No deployments.");
    return;
  }
  printLine(
    renderTable(
      deployments.map((deployment) => ({
        slug: deployment.slug,
        name: deployment.name,
        interfaces: formatTargets(deployment),
        status: agentDeploymentStatus(deployment),
        memory: deployment.targetPath || "/",
      })),
      [
        { key: "slug", header: "SLUG" },
        { key: "name", header: "NAME" },
        { key: "interfaces", header: "INTERFACES" },
        { key: "status", header: "STATUS" },
        { key: "memory", header: "MEMORY" },
      ],
    ),
  );
}

function printDeployment(deployment: DeploymentDetail): void {
  printLine(`${deployment.name} (${deployment.slug})`);
  printLine(`Status: ${agentDeploymentStatus(deployment)}`);
  printLine(`Memory: ${deployment.targetPath || "/"}`);
  printLine(
    `Interfaces: ${deployment.targets.length ? formatTargets(deployment) : "none"}`,
  );
  if (deployment.instructions) {
    printLine(`Instructions: ${deployment.instructions}`);
  }
  for (const target of deployment.targets) {
    if (target.embed) {
      printLine(`${target.platform} embed:`);
      printLine(target.embed);
    }
    if (target.error) {
      printLine(`${target.platform} error: ${target.error}`);
    }
  }
}

function parseInterfaceRequest(platform: DeploymentPlatform): InterfaceRequest {
  if (platform === "slack") return { platform };

  return { platform, widget: { allowedDomains: [] } };
}

function formatTargets(deployment: DeploymentSummary): string {
  return deployment.targets
    .map((target) =>
      target.name ? `${target.platform} (${target.name})` : target.platform,
    )
    .join(", ");
}

export function agentDeploymentStatus(deployment: DeploymentSummary): string {
  if (!deployment.enabled) return "disabled";
  if (deployment.targets.some((target) => target.status === "active")) {
    return "active";
  }
  if (deployment.targets.some((target) => target.status === "error")) {
    return "error";
  }
  return "not connected";
}
