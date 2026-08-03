import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  apiUrl?: string;
  sessionToken?: string;
  /** Epoch milliseconds when the session token expires. */
  expiresAt?: number;
  defaultWorkspaceId?: string;
}

export function configPath(): string {
  return join(process.env.HOME ?? homedir(), ".nimbase", "config.json");
}

/**
 * Why the config didn't load, when it didn't.
 *
 * A missing file is the ordinary pre-login state and is NOT a problem. An
 * unparseable one is: it used to be indistinguishable from "never logged in",
 * so every command said "not authenticated" and nothing told the user their
 * config was corrupt.
 */
export type ConfigProblem = "unreadable" | "malformed";

export interface ConfigRead {
  config: CliConfig;
  problem: ConfigProblem | null;
}

/**
 * Read the config and say why it didn't parse, when it didn't.
 *
 * Separate from `loadConfig` so `doctor` can report a corrupt file without the
 * two of them communicating through module state — an earlier version cached
 * the problem from "the most recent load", which only worked because doctor
 * happened to build a context first.
 */
export async function readConfig(): Promise<ConfigRead> {
  let raw: string;
  try {
    raw = await readFile(configPath(), "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    return { config: {}, problem: code === "ENOENT" ? null : "unreadable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { config: {}, problem: "malformed" };
  }
  // A valid-JSON array, string, or null is still not a config object.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { config: {}, problem: "malformed" };
  }
  return { config: parsed as CliConfig, problem: null };
}

/** The config alone — the front door for everything that just needs values. */
export async function loadConfig(): Promise<CliConfig> {
  return (await readConfig()).config;
}

export async function saveConfig(config: CliConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  // 0600: the file holds a bearer session token — keep it owner-only.
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}
