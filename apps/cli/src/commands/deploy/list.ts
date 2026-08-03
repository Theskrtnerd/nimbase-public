import type { Command } from "commander";

import type {
  ArtifactSummary,
  DeploymentRef,
  DeploymentSummary,
  DocSiteSummary,
  GroupMcpSummary,
} from "@acme/validators/cli";
import {
  artifactsResponseSchema,
  deploymentsResponseSchema,
  docSitesResponseSchema,
  formatDeploymentRef,
  groupMcpsResponseSchema,
} from "@acme/validators/cli";

import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { printJson, printLine, renderTable } from "../../output";
import { collectAllPages } from "../../paginate";
import { resolveWorkspace } from "../../workspace";
import { agentDeploymentStatus } from "./agent";

type DeploymentWithoutRef =
  | ({ type: "agent" } & DeploymentSummary)
  | ({ type: "artifact" } & ArtifactSummary)
  | ({ type: "docs" } & DocSiteSummary)
  | ({ type: "mcp" } & GroupMcpSummary);
type UnifiedDeployment = DeploymentWithoutRef & { ref: DeploymentRef };

export function registerDeployList(program: Command): void {
  program
    .command("list")
    .description("List all deployment types")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, "Deployment listing");
      const workspaceId = await resolveWorkspace(ctx);

      const [agents, artifacts, docs, mcp] = await Promise.all([
        ctx.client.request("GET", "/api/deployments", {
          query: { workspaceId },
          schema: deploymentsResponseSchema,
        }),
        collectAllPages(async (cursor) => {
          const page = await ctx.client.request("GET", "/api/artifacts", {
            query: { workspaceId, cursor },
            schema: artifactsResponseSchema,
          });
          return { items: page.artifacts, nextCursor: page.nextCursor };
        }),
        ctx.client.request("GET", "/api/deployments/docs", {
          query: { workspaceId },
          schema: docSitesResponseSchema,
        }),
        ctx.client.request("GET", "/api/deployments/mcp", {
          query: { workspaceId },
          schema: groupMcpsResponseSchema,
        }),
      ]);

      const deployments = [
        ...agents.deployments.map((deployment) => ({
          type: "agent" as const,
          ...deployment,
        })),
        ...artifacts.map((artifact) => ({
          type: "artifact" as const,
          ...artifact,
        })),
        ...docs.deployments.map((deployment) => ({
          type: "docs" as const,
          ...deployment,
        })),
        ...mcp.deployments.map((deployment) => ({
          type: "mcp" as const,
          ...deployment,
        })),
      ].map((deployment) => ({
        ...deployment,
        ref: formatDeploymentRef(deployment.type, deployment.slug),
      })) satisfies UnifiedDeployment[];

      if (ctx.globals.json) {
        printJson({ deployments });
        return;
      }
      if (deployments.length === 0) {
        printLine("No deployments.");
        return;
      }
      printLine(
        renderTable(deployments.map(deploymentRow), [
          { key: "type", header: "TYPE" },
          { key: "name", header: "NAME" },
          { key: "identifier", header: "SLUG" },
          { key: "ref", header: "REF" },
          { key: "status", header: "STATUS" },
        ]),
      );
    });
}

function deploymentRow(deployment: UnifiedDeployment): {
  type: string;
  name: string;
  identifier: string;
  status: string;
  ref: DeploymentRef;
} {
  if (deployment.type === "artifact") {
    return {
      type: deployment.type,
      name: deployment.title,
      identifier: deployment.slug,
      ref: deployment.ref,
      status: deployment.status,
    };
  }
  if (deployment.type === "agent") {
    return {
      type: deployment.type,
      name: deployment.name,
      identifier: deployment.slug,
      ref: deployment.ref,
      status: agentDeploymentStatus(deployment),
    };
  }
  if (deployment.type === "mcp") {
    return {
      type: deployment.type,
      name: deployment.name,
      identifier: deployment.slug,
      ref: deployment.ref,
      status: deployment.enabled ? "active" : "paused",
    };
  }
  return {
    type: deployment.type,
    name: deployment.name,
    identifier: deployment.slug,
    ref: deployment.ref,
    status: deployment.status,
  };
}
