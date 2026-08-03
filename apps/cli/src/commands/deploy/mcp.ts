import type { Command } from "commander";

import type { GroupMcpSummary, GroupMcpTool } from "@acme/validators/cli";
import {
  groupMcpsResponseSchema,
  groupMcpSummarySchema,
  groupMcpToolSchema,
  resourceSlugSchema,
} from "@acme/validators/cli";

import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { usageError } from "../../errors";
import { printJson, printLine, renderTable } from "../../output";
import { resolveWorkspace } from "../../workspace";

const DEFAULT_TOOLS: GroupMcpTool[] = ["search", "get_note", "list_sources"];

interface CreateFlags {
  slug?: string;
  folder?: string;
  tool: string[];
}

export function registerDeployMcp(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("Create and manage governed MCP endpoints");

  mcp
    .command("create")
    .description("Create an OAuth-only MCP endpoint from a prompt")
    .argument("<prompt>", "what to deploy")
    .option("--slug <slug>", "stable endpoint identifier")
    .option("--folder <path>", "memory folder (default: whole workspace KB)")
    .option(
      "--tool <tool>",
      "tool to expose; repeat for multiple tools",
      collect,
      [],
    )
    .action(async (prompt: string, options: CreateFlags, command: Command) => {
      validateSlug(options.slug);
      const tools = parseTools(options.tool);
      const ctx = await createContext(command);
      requireSession(ctx.config, "MCP deployment");
      const workspaceId = await resolveWorkspace(ctx);
      const deployment = await ctx.client.request(
        "POST",
        "/api/deployments/mcp",
        {
          body: {
            workspaceId,
            name: prompt,
            slug: options.slug,
            folderPath: options.folder,
            tools,
          },
          schema: groupMcpSummarySchema,
        },
      );
      if (ctx.globals.json) {
        printJson(deployment);
      } else {
        printLine(`Deployed MCP endpoint ${deployment.slug}.`);
        printLine(`URL: ${deployment.url}`);
        printLine("Authentication: OAuth");
      }
    });

  mcp
    .command("list")
    .description("List MCP deployments")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, "MCP deployment");
      const workspaceId = await resolveWorkspace(ctx);
      const result = await ctx.client.request("GET", "/api/deployments/mcp", {
        query: { workspaceId },
        schema: groupMcpsResponseSchema,
      });
      if (ctx.globals.json) {
        printJson(result);
      } else {
        printMcpDeployments(result.deployments);
      }
    });

  mcp
    .command("get")
    .description("Inspect an MCP deployment")
    .argument("<slug>", "endpoint slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, "MCP deployment");
      const workspaceId = await resolveWorkspace(ctx);
      const deployment = await ctx.client.request(
        "GET",
        `/api/deployments/mcp/${encodeURIComponent(slug)}`,
        {
          query: { workspaceId },
          schema: groupMcpSummarySchema,
        },
      );
      if (ctx.globals.json) {
        printJson(deployment);
      } else {
        printMcpDeployment(deployment);
      }
    });

  mcp
    .command("remove")
    .description("Remove an MCP endpoint and revoke any legacy keys")
    .argument("<slug>", "endpoint slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, "MCP deployment");
      const workspaceId = await resolveWorkspace(ctx);
      await ctx.client.request(
        "DELETE",
        `/api/deployments/mcp/${encodeURIComponent(slug)}`,
        { query: { workspaceId } },
      );
      if (ctx.globals.json) {
        printJson({ ok: true, slug });
      } else {
        printLine(`Removed MCP endpoint ${slug}.`);
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseTools(values: string[]): GroupMcpTool[] {
  if (values.length === 0) return DEFAULT_TOOLS;
  return values.map((value) => {
    const parsed = groupMcpToolSchema.safeParse(value);
    if (!parsed.success) {
      throw usageError(
        `--tool must be one of: ${groupMcpToolSchema.options.join(", ")}`,
      );
    }
    return parsed.data;
  });
}

function validateSlug(slug: string | undefined): void {
  if (slug && !resourceSlugSchema.safeParse(slug).success) {
    throw usageError("--slug must be a kebab-case identifier");
  }
}

function printMcpDeployments(deployments: GroupMcpSummary[]): void {
  if (deployments.length === 0) {
    printLine("No MCP deployments.");
    return;
  }
  printLine(
    renderTable(
      deployments.map((deployment) => ({
        slug: deployment.slug,
        name: deployment.name,
        tools: deployment.tools.join(","),
        memory: deployment.folderPath || "whole KB",
        status: deployment.enabled ? "active" : "paused",
      })),
      [
        { key: "slug", header: "SLUG" },
        { key: "name", header: "NAME" },
        { key: "tools", header: "TOOLS" },
        { key: "memory", header: "MEMORY" },
        { key: "status", header: "STATUS" },
      ],
    ),
  );
}

function printMcpDeployment(deployment: GroupMcpSummary): void {
  printLine(`${deployment.name} (${deployment.slug})`);
  printLine(`Status: ${deployment.enabled ? "active" : "paused"}`);
  printLine(`URL: ${deployment.url}`);
  printLine("Authentication: OAuth");
  printLine(`Memory: ${deployment.folderPath || "whole KB"}`);
  printLine(`Tools: ${deployment.tools.join(", ")}`);
  if (deployment.instructions) {
    printLine(`Instructions: ${deployment.instructions}`);
  }
}
