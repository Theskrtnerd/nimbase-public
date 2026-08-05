import type { Command } from "commander";

import type { WorkspaceCreateRequest } from "@acme/validators/cli";
import {
  workspaceCreatedSchema,
  workspaceCreateRequestSchema,
} from "@acme/validators/cli";

import { saveConfig } from "../../config";
import { createContext } from "../../context";
import { resolveCredential } from "../../credentials";
import { CliError, usageError } from "../../errors";
import { login } from "../../login";
import { printJson, printLine } from "../../output";
import { listWorkspaces } from "../../workspace";

interface InitOptions {
  title?: string;
  description?: string;
}

export function registerWorkspaceCreate(program: Command): void {
  program
    .command("create")
    .description("Create a workspace from its website or explicit identity")
    .argument("[website]", "HTTPS company website used to seed company.md")
    .option("--title <text>", "company title; overrides website-derived title")
    .option(
      "--description <text>",
      "company description; overrides website-derived description",
    )
    .action(
      async (
        website: string | undefined,
        options: InitOptions,
        command: Command,
      ) => {
        const input = parseCreateInput(website, options);
        let ctx = await createContext(command);
        const credential = resolveCredential(ctx.config);
        if (credential.mode === "apiToken") {
          throw new CliError(
            "`nimbase workspace create` requires a browser login.",
            4,
          );
        }
        if (credential.mode === "none") {
          await login(ctx.baseUrl);
          ctx = await createContext(command);
        }

        const manualTitle = "title" in input ? input.title : null;
        const matches = manualTitle
          ? (await listWorkspaces(ctx.client)).filter(
              (workspace) =>
                workspace.name.toLowerCase() === manualTitle.toLowerCase(),
            )
          : [];
        if (matches.length > 1) {
          throw new CliError(
            `Multiple workspaces named "${manualTitle}" — select one with \`nimbase workspace use <slug>\`.`,
            2,
          );
        }

        const existing = matches[0];
        if (existing) {
          await saveConfig({
            ...ctx.config,
            defaultWorkspaceId: existing.id,
          });
          if (ctx.globals.json) {
            printJson({
              created: false,
              workspace: { name: existing.name, slug: existing.slug },
            });
          } else {
            printLine(
              `Using existing workspace ${existing.name} (${existing.slug})`,
            );
          }
          return;
        }

        const created = await ctx.client.request("POST", "/api/workspaces", {
          body: input,
          schema: workspaceCreatedSchema,
        });
        await saveConfig({
          ...ctx.config,
          defaultWorkspaceId: created.workspace.id,
        });

        if (ctx.globals.json) {
          printJson({
            created: true,
            workspace: {
              name: created.workspace.name,
              slug: created.workspace.slug,
              description: created.workspace.description,
              website: created.workspace.website,
              brainInitStatus: created.workspace.brainInitStatus,
            },
          });
        } else {
          printLine(
            `Initialized ${created.workspace.name} (${created.workspace.slug})`,
          );
          if ("website" in input) {
            printLine(
              "Nimbase is reading the company website and preparing company.md.",
            );
          } else {
            printLine("Nimbase is preparing company.md in the background.");
          }
        }
      },
    );
}

function parseCreateInput(
  websiteArg: string | undefined,
  options: InitOptions,
): WorkspaceCreateRequest {
  const website = websiteArg?.trim();
  const title = options.title?.trim();
  const description = options.description?.trim();

  const candidate = website
    ? {
        website:
          website.startsWith("http://") || website.startsWith("https://")
            ? website
            : `https://${website}`,
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      }
    : { title, description };
  const parsed = workspaceCreateRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw usageError(
      "Provide a website, or provide both --title <text> and --description <text>.",
    );
  }
  return parsed.data;
}
