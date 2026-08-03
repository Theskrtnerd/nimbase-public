import type { Command } from "commander";

import type { DocSiteSummary } from "@acme/validators/cli";
import {
  docSiteBuildSchema,
  docSitesResponseSchema,
  docSiteSummarySchema,
  resourceSlugSchema,
} from "@acme/validators/cli";

import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { CliError, usageError } from "../../errors";
import { printJson, printLine, renderTable } from "../../output";
import { resolveWorkspace } from "../../workspace";

const SUBJECT = "Docs site deployment";
const BASE = "/api/deployments/docs";

interface CreateFlags {
  folder?: string;
  slug?: string;
  description?: string;
  public?: boolean;
}

interface PublishOptions {
  wait?: boolean;
}

export function registerDeployDocs(program: Command): void {
  const docs = program
    .command("docs")
    .description("Create and publish documentation sites from company memory");

  docs
    .command("create")
    .description("Create a documentation site from a prompt")
    .argument("<prompt>", "what to deploy")
    .option("--folder <path>", "memory folder (default: whole workspace KB)")
    .option("--slug <slug>", "stable site identifier")
    .option("--description <text>", "one-line description used for meta tags")
    .option(
      "--public",
      "publish to anyone with the link (default: readers of the memory folder)",
    )
    .action(async (prompt: string, options: CreateFlags, command: Command) => {
      validateSlug(options.slug);
      const ctx = await createContext(command);
      requireSession(ctx.config, SUBJECT);
      const workspaceId = await resolveWorkspace(ctx);
      const deployment = await ctx.client.request("POST", BASE, {
        body: {
          workspaceId,
          name: prompt,
          slug: options.slug,
          folderPath: options.folder,
          description: options.description,
          visibility: options.public ? "public" : "private",
        },
        schema: docSiteSummarySchema,
      });
      if (ctx.globals.json) {
        printJson(deployment);
      } else {
        printLine(`Created docs site ${deployment.slug}.`);
        printLine(`URL: ${deployment.url}`);
        printLine(
          `Nothing is published yet — run \`nimbase deploy docs publish ${deployment.slug}\`.`,
        );
      }
    });

  docs
    .command("list")
    .description("List documentation sites")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, SUBJECT);
      const workspaceId = await resolveWorkspace(ctx);
      const result = await ctx.client.request("GET", BASE, {
        query: { workspaceId },
        schema: docSitesResponseSchema,
      });
      if (ctx.globals.json) {
        printJson(result);
      } else {
        printDocSites(result.deployments);
      }
    });

  docs
    .command("get")
    .description("Inspect a documentation site")
    .argument("<slug>", "site slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, SUBJECT);
      const workspaceId = await resolveWorkspace(ctx);
      const deployment = await ctx.client.request(
        "GET",
        `${BASE}/${encodeURIComponent(slug)}`,
        { query: { workspaceId }, schema: docSiteSummarySchema },
      );
      if (ctx.globals.json) {
        printJson(deployment);
      } else {
        printDocSite(deployment);
      }
    });

  docs
    .command("publish")
    .description("Rebuild and publish a documentation site from memory")
    .argument("<slug>", "site slug")
    .option("--wait", "wait for the build to finish")
    .action(async (slug: string, options: PublishOptions, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, SUBJECT);
      const workspaceId = await resolveWorkspace(ctx);
      const started = await ctx.client.request(
        "POST",
        `${BASE}/${encodeURIComponent(slug)}/publish`,
        { query: { workspaceId }, body: { workspaceId } },
      );
      const buildId = (started as { buildId?: string }).buildId;

      if (!options.wait) {
        if (ctx.globals.json) {
          printJson(started);
        } else {
          printLine(`Publishing ${slug} (build ${buildId ?? "queued"}).`);
          printLine(
            `Follow it with \`nimbase deploy docs publish ${slug} --wait\`.`,
          );
        }
        return;
      }

      const final = await waitForBuild(ctx, slug, workspaceId, buildId);
      if (ctx.globals.json) {
        printJson(final);
        // A failed build is a failed command — scripts must be able to tell.
        if (final.status === "failed")
          throw new CliError(final.error ?? "Build failed", 1);
        return;
      }
      if (final.status === "failed") {
        throw new CliError(final.error ?? "The build failed", 1);
      }
      printLine(`Published ${slug} (${final.pageCount} pages).`);
      if (final.log) printLine(final.log);
    });

  docs
    .command("remove")
    .description("Remove a documentation site")
    .argument("<slug>", "site slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const ctx = await createContext(command);
      requireSession(ctx.config, SUBJECT);
      const workspaceId = await resolveWorkspace(ctx);
      await ctx.client.request(
        "DELETE",
        `${BASE}/${encodeURIComponent(slug)}`,
        { query: { workspaceId } },
      );
      if (ctx.globals.json) {
        printJson({ ok: true, slug });
      } else {
        printLine(`Removed docs site ${slug}.`);
      }
    });
}

/** Poll interval and ceiling for `--wait`. A docs build runs on CI minutes. */
const POLL_MS = 4000;
const WAIT_CEILING_MS = 15 * 60 * 1000;

async function waitForBuild(
  ctx: Awaited<ReturnType<typeof createContext>>,
  slug: string,
  workspaceId: string,
  buildId: string | undefined,
) {
  const deadline = Date.now() + WAIT_CEILING_MS;
  for (;;) {
    const build = await ctx.client.request(
      "GET",
      `${BASE}/${encodeURIComponent(slug)}/publish`,
      {
        query: buildId ? { workspaceId, buildId } : { workspaceId },
        schema: docSiteBuildSchema,
      },
    );
    if (build.status === "succeeded" || build.status === "failed") return build;
    if (Date.now() > deadline) {
      // Don't silently report success on a build we stopped watching.
      throw new CliError(
        `Timed out waiting for ${slug}. The build is still running — check \`nimbase deploy docs get ${slug}\`.`,
        1,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function validateSlug(slug: string | undefined): void {
  if (slug && !resourceSlugSchema.safeParse(slug).success) {
    throw usageError("--slug must be a kebab-case identifier");
  }
}

function printDocSites(deployments: DocSiteSummary[]): void {
  if (deployments.length === 0) {
    printLine("No documentation sites.");
    return;
  }
  printLine(
    renderTable(
      deployments.map((deployment) => ({
        slug: deployment.slug,
        name: deployment.name,
        memory: deployment.folderPath || "whole KB",
        visibility: deployment.visibility,
        status: deployment.status,
      })),
      [
        { key: "slug", header: "SLUG" },
        { key: "name", header: "NAME" },
        { key: "memory", header: "MEMORY" },
        { key: "visibility", header: "VISIBILITY" },
        { key: "status", header: "STATUS" },
      ],
    ),
  );
}

function printDocSite(deployment: DocSiteSummary): void {
  printLine(`Slug:       ${deployment.slug}`);
  printLine(`Name:       ${deployment.name}`);
  printLine(`Memory:     ${deployment.folderPath || "whole KB"}`);
  printLine(`Visibility: ${deployment.visibility}`);
  printLine(`Status:     ${deployment.status}`);
  printLine(`URL:        ${deployment.url}`);
  printLine(`Template:   ${deployment.templateVersion}`);
  printLine(`Last built: ${deployment.lastBuiltAt ?? "never"}`);
  if (deployment.error) printLine(`Error:      ${deployment.error}`);
}
