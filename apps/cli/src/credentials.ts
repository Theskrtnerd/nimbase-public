import type { CliConfig } from "./config";
import { CliError } from "./errors";

const DEFAULT_API_URL = "https://app.nimbase.ai";

export interface Credential {
  mode: "apiToken" | "session" | "none";
  token: string | null;
}

/** Base URL precedence: NIMBASE_API_URL env > config.apiUrl > production. */
export function resolveBaseUrl(config: CliConfig): string {
  return process.env.NIMBASE_API_URL ?? config.apiUrl ?? DEFAULT_API_URL;
}

/**
 * Active credential precedence:
 *   1. NIMBASE_TOKEN env  → automation mode (folder-scoped ApiToken)
 *   2. stored, non-expired session token → human mode
 *   3. none
 */
export function resolveCredential(config: CliConfig): Credential {
  const envToken = process.env.NIMBASE_TOKEN?.trim();
  if (envToken) return { mode: "apiToken", token: envToken };
  if (config.sessionToken && (config.expiresAt ?? Infinity) > Date.now()) {
    return { mode: "session", token: config.sessionToken };
  }
  return { mode: "none", token: null };
}

/**
 * Administration (OAuth, provisioning, governance) needs a real browser
 * session — a folder-scoped ApiToken can't perform it. Callers assert this
 * before any network work so an unusable credential fails fast.
 */
export function requireSession(config: CliConfig, subject: string): void {
  if (resolveCredential(config).mode !== "session") {
    throw new CliError(
      `${subject} requires a user session. Run \`nimbase auth login\`.`,
      4,
    );
  }
}
