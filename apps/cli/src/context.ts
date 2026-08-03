import type { Command } from "commander";

import type { CliConfig } from "./config";
import { ApiClient } from "./client";
import { loadConfig } from "./config";
import { resolveBaseUrl, resolveCredential } from "./credentials";

export interface GlobalOptions {
  json: boolean;
  workspace?: string;
}

export interface CliContext {
  globals: GlobalOptions;
  config: CliConfig;
  baseUrl: string;
  client: ApiClient;
}

/**
 * Assemble the per-invocation context from the loaded config + global flags.
 * `command.optsWithGlobals()` merges the root program options into the
 * subcommand's, so `--json` etc. are visible regardless of position.
 */
export async function createContext(command: Command): Promise<CliContext> {
  const merged = command.optsWithGlobals<{
    json?: boolean;
    workspace?: string;
  }>();
  const globals: GlobalOptions = {
    json: merged.json ?? false,
    workspace: merged.workspace,
  };
  const config = await loadConfig();
  const baseUrl = resolveBaseUrl(config);
  const client = new ApiClient(baseUrl, resolveCredential(config));
  return { globals, config, baseUrl, client };
}
