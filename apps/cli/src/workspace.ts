import type { Command } from "commander";

import type { WorkspaceSummary } from "@acme/validators/cli";
import { workspaceListResponseSchema } from "@acme/validators/cli";

import type { ApiClient } from "./client";
import type { CliConfig } from "./config";
import type { CliContext } from "./context";
import { createContext } from "./context";
import { resolveCredential } from "./credentials";
import { CliError, EXIT, notFound, usageError } from "./errors";

export async function listWorkspaces(
  client: ApiClient,
): Promise<WorkspaceSummary[]> {
  const { workspaces } = await client.request("GET", "/api/workspaces", {
    schema: workspaceListResponseSchema,
  });
  return workspaces;
}

export async function resolveWorkspaceSlug(
  client: ApiClient,
  slug: string,
): Promise<WorkspaceSummary> {
  const workspace = (await listWorkspaces(client)).find(
    (candidate) => candidate.slug.toLowerCase() === slug.toLowerCase(),
  );
  if (!workspace) {
    throw notFound(`No workspace with slug "${slug}"`);
  }
  return workspace;
}

/**
 * Resolve the internal workspace id to act on. The public identifier is always
 * the workspace slug; the UUID remains an implementation detail in config and
 * API requests.
 */
export async function resolveWorkspaceId(opts: {
  client: ApiClient;
  config: CliConfig;
  override?: string;
}): Promise<string> {
  const { client, config, override } = opts;
  // Credential first. Without this, a signed-out user asking for a workspace-
  // scoped command was told "No workspace selected" and sent to
  // `workspace use`, which cannot work until they log in.
  if (resolveCredential(config).mode === "none") {
    throw new CliError(
      "Not authenticated. Run `nimbase auth login`.",
      EXIT.auth,
      { code: "auth_required" },
    );
  }
  if (override) {
    return (await resolveWorkspaceSlug(client, override)).id;
  }
  if (config.defaultWorkspaceId) return config.defaultWorkspaceId;
  throw usageError(
    "No workspace selected. Run `nimbase workspace use <slug>` or pass --workspace <slug>.",
  );
}

/**
 * Resolve the workspace for a command from its invocation context — the shared
 * form used by every workspace-scoped command (`--workspace` override → stored
 * default).
 */
export function resolveWorkspace(ctx: CliContext): Promise<string> {
  return resolveWorkspaceId({
    client: ctx.client,
    config: ctx.config,
    override: ctx.globals.workspace,
  });
}

export interface WorkspaceScope {
  ctx: CliContext;
  workspaceId: string;
}

/**
 * The opening move of every workspace-scoped command: build the invocation
 * context, then resolve which workspace to act on. Commands that additionally
 * require a browser session call `requireSession` on `ctx.config` first, so
 * the credential check fails before this does any network work.
 */
export async function workspaceScope(
  command: Command,
): Promise<WorkspaceScope> {
  const ctx = await createContext(command);
  return { ctx, workspaceId: await resolveWorkspace(ctx) };
}
