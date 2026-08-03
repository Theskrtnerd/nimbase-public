import type { Command } from "commander";

import type { ArtifactStatus } from "@acme/validators/cli";
import {
  artifactCreatedSchema,
  artifactsResponseSchema,
  artifactStatusSchema,
  artifactVisibilitySchema,
} from "@acme/validators/cli";

import type { ApiClient } from "../../client";
import { CliError, usageError } from "../../errors";
import { printJson, printLine, renderTable } from "../../output";
import { collectAllPages } from "../../paginate";
import { sleep } from "../../wait";
import { workspaceScope } from "../../workspace";

const VISIBILITIES = artifactVisibilitySchema.options;
const POLL_MS = 2000;
const WAIT_TIMEOUT_MS = 120_000;

interface CreateOptions {
  kind?: string;
  folder?: string;
  visibility?: string;
  slug?: string;
  wait?: boolean;
}

export function registerDeployArtifact(program: Command): void {
  const artifact = program
    .command("artifact")
    .description("Generate and manage AI artifacts");

  artifact
    .command("create")
    .description("Generate an artifact from a prompt (generation is async)")
    .argument("<prompt>", "what to deploy")
    .option("--slug <slug>", "stable artifact identifier")
    .option("--kind <kind>", "fixed | freeform", "fixed")
    .option("--folder <uuid>", "target folder id (omit for root)")
    .option("--visibility <v>", "private | public", "private")
    .option("--wait", "block until the artifact is ready")
    .action(
      async (prompt: string, options: CreateOptions, command: Command) => {
        const { ctx, workspaceId } = await workspaceScope(command);

        const created = await ctx.client.request("POST", "/api/artifacts", {
          body: {
            workspaceId,
            prompt,
            kind: options.kind,
            targetFolderId: options.folder,
            visibility: options.visibility,
            slug: options.slug,
          },
          schema: artifactCreatedSchema,
        });

        if (!options.wait) {
          if (ctx.globals.json) printJson(created);
          else {
            printLine(
              `Artifact ${created.status}. slug ${created.slug} — poll with \`nimbase deploy artifact get ${created.slug}\`.`,
            );
          }
          return;
        }

        const final = await waitForArtifact(
          ctx.client,
          workspaceId,
          created.slug,
        );
        if (ctx.globals.json) {
          printJson(final);
        } else if (final.ready) {
          printLine(`Artifact ready: ${final.url}`);
        } else {
          printLine(
            `Artifact ${final.status}${final.error ? `: ${final.error}` : ""}`,
          );
        }
        if (final.status === "failed") {
          throw new CliError(final.error ?? "artifact generation failed", 1);
        }
      },
    );

  artifact
    .command("list")
    .description("List artifacts in this workspace")
    .action(async (_options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const artifacts = await collectAllPages(async (cursor) => {
        const page = await ctx.client.request("GET", "/api/artifacts", {
          query: { workspaceId, cursor },
          schema: artifactsResponseSchema,
        });
        return { items: page.artifacts, nextCursor: page.nextCursor };
      });

      if (ctx.globals.json) {
        printJson({ artifacts });
        return;
      }
      if (artifacts.length === 0) {
        printLine("No artifacts.");
        return;
      }
      printLine(
        renderTable(
          artifacts.map((row) => ({
            status: row.status,
            visibility: row.visibility,
            title: row.title,
            slug: row.slug,
          })),
          [
            { key: "status", header: "STATUS" },
            { key: "visibility", header: "VISIBILITY" },
            { key: "title", header: "TITLE" },
            { key: "slug", header: "SLUG" },
          ],
        ),
      );
    });

  artifact
    .command("get")
    .description("Show an artifact's generation status")
    .argument("<slug>", "artifact slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const status = await ctx.client.request(
        "GET",
        `/api/artifacts/${encodeURIComponent(slug)}/status`,
        {
          query: { workspaceId },
          schema: artifactStatusSchema,
          notFound: `No artifact with slug ${slug} in this workspace.`,
        },
      );
      if (ctx.globals.json) {
        printJson(status);
        return;
      }
      printLine(`Status: ${status.status}${status.ready ? " (ready)" : ""}`);
      if (status.url) printLine(`URL: ${status.url}`);
      printLine(`Visibility: ${status.visibility}`);
      if (status.error) printLine(`Error: ${status.error}`);
    });

  artifact
    .command("access")
    .description("Change an artifact's share visibility")
    .argument("<slug>", "artifact slug")
    .argument("<visibility>", "private | public")
    .action(
      async (
        slug: string,
        visibility: string,
        _options: unknown,
        command: Command,
      ) => {
        if (!artifactVisibilitySchema.safeParse(visibility).success) {
          throw usageError(
            `visibility must be one of: ${VISIBILITIES.join(", ")}`,
          );
        }
        const { ctx, workspaceId } = await workspaceScope(command);
        const res = await ctx.client.request<{
          url: string;
          visibility: string;
        }>("PATCH", `/api/artifacts/${encodeURIComponent(slug)}/access`, {
          body: { workspaceId, visibility },
        });
        if (ctx.globals.json) printJson(res);
        else printLine(`Visibility set to ${res.visibility} — ${res.url}`);
      },
    );

  artifact
    .command("remove")
    .description("Delete an artifact and revoke its share link")
    .argument("<slug>", "artifact slug")
    .action(async (slug: string, _options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      await ctx.client.request(
        "DELETE",
        `/api/artifacts/${encodeURIComponent(slug)}`,
        {
          query: { workspaceId },
          notFound: `No artifact with slug ${slug} in this workspace.`,
        },
      );
      if (ctx.globals.json) printJson({ ok: true, slug });
      else printLine(`Removed artifact ${slug}`);
    });
}

async function waitForArtifact(
  client: ApiClient,
  workspaceId: string,
  artifactSlug: string,
): Promise<ArtifactStatus> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const status = await client.request(
      "GET",
      `/api/artifacts/${encodeURIComponent(artifactSlug)}/status`,
      { query: { workspaceId }, schema: artifactStatusSchema },
    );
    if (status.ready || status.status === "failed") return status;
    if (Date.now() > deadline) {
      throw new CliError("Timed out waiting for artifact generation", 1);
    }
    await sleep(POLL_MS);
  }
}
