import { stat } from "node:fs/promises";
import type { Command } from "commander";

import {
  connectionsResponseSchema,
  workspaceStatusSchema,
} from "@acme/validators/cli";

import { configPath, readConfig } from "../config";
import { createContext } from "../context";
import { resolveCredential } from "../credentials";
import { CliError } from "../errors";
import { printJson, printLine, renderTable } from "../output";
import { resolveWorkspace } from "../workspace";

type CheckLevel = "pass" | "warn" | "fail";

interface DoctorCheck {
  name: string;
  level: CheckLevel;
  message: string;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose CLI, authentication, workspace, and sync health")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      const checks: DoctorCheck[] = [];
      const major = Number(process.versions.node.split(".")[0]);
      checks.push({
        name: "runtime",
        level: major >= 18 ? "pass" : "fail",
        message: `Node ${process.versions.node}`,
      });

      const credential = resolveCredential(ctx.config);
      checks.push({
        name: "credential",
        level: credential.mode === "none" ? "fail" : "pass",
        message:
          credential.mode === "none"
            ? "No active credential"
            : `Authenticated with ${credential.mode}`,
      });

      const mode = await configMode();
      checks.push({
        name: "config permissions",
        level: mode === null || mode === 0o600 ? "pass" : "warn",
        message:
          mode === null
            ? "Config file not created yet"
            : `Config mode ${mode.toString(8).padStart(3, "0")}`,
      });

      // A config the CLI silently fell back to `{}` for looks exactly like
      // "never logged in" from every other command. Say so here.
      const { problem } = await readConfig();
      if (problem) {
        checks.push({
          name: "config file",
          level: "fail",
          message:
            problem === "malformed"
              ? `${configPath()} is not valid JSON — delete it and run \`nimbase auth login\``
              : `${configPath()} could not be read — check its ownership and permissions`,
        });
      }

      if (credential.mode !== "none") {
        // Resolved before the API calls and reported under its own name:
        // folding it into the `api` check made "No workspace selected" look
        // like the API was unreachable.
        let workspaceId: string;
        try {
          workspaceId = await resolveWorkspace(ctx);
        } catch (error) {
          checks.push({
            name: "workspace selection",
            level: "fail",
            message: error instanceof Error ? error.message : String(error),
          });
          return report(ctx.globals.json, checks);
        }

        try {
          const [status, connections] = await Promise.all([
            ctx.client.request("GET", "/api/status", {
              query: { workspaceId },
              schema: workspaceStatusSchema,
            }),
            ctx.client.request("GET", "/api/connections", {
              query: { workspaceId },
              schema: connectionsResponseSchema,
            }),
          ]);
          checks.push({
            name: "api",
            level: "pass",
            message: `Reached ${ctx.baseUrl}`,
          });
          checks.push({
            name: "workspace",
            level:
              status.workspace.brainInitStatus === "failed" ? "fail" : "pass",
            message: `${status.workspace.name} · brain ${status.workspace.brainInitStatus}`,
          });
          // Provider availability is Nimbase-side OAuth configuration, not
          // something the user can act on — so it reports as `pass` with the
          // available list rather than a permanent warning about our setup.
          const available = connections.providers.filter(
            (provider) => provider.configured,
          );
          const unavailable = connections.providers.filter(
            (provider) => !provider.configured,
          );
          checks.push({
            name: "providers",
            level: available.length > 0 ? "pass" : "fail",
            message:
              available.length === 0
                ? "No sync providers are available on this deployment"
                : `Available: ${available.map((provider) => provider.label).join(", ")}${
                    unavailable.length > 0
                      ? ` (not yet offered: ${unavailable.map((provider) => provider.label).join(", ")})`
                      : ""
                  }`,
          });
          checks.push({
            name: "source configuration",
            level: status.connections.incomplete.length > 0 ? "warn" : "pass",
            message:
              status.connections.incomplete.length > 0
                ? `${status.connections.incomplete.length} connection(s) need scope selection`
                : // Distinguished so a clean bill of health isn't reported for
                  // a workspace that simply has nothing connected yet.
                  status.connections.total === 0
                  ? "No sources connected yet"
                  : "Connected sources are configured",
          });
          checks.push({
            name: "sync health",
            level: status.connections.unhealthy.length > 0 ? "fail" : "pass",
            message:
              status.connections.unhealthy.length > 0
                ? `${status.connections.unhealthy.length} unhealthy connection(s)`
                : "No connection failures",
          });
          const failedCaptures = status.captures.byStatus.failed ?? 0;
          checks.push({
            name: "capture health",
            level: failedCaptures > 0 ? "warn" : "pass",
            message:
              failedCaptures > 0
                ? `${failedCaptures} failed capture(s)`
                : "No failed captures",
          });
        } catch (error) {
          // A 401/403 means the API answered fine and refused us, so reporting
          // it under "api" pointed at the wrong thing entirely — most often a
          // stored default workspace the credential can no longer reach.
          const status =
            error instanceof CliError ? error.httpStatus : undefined;
          checks.push({
            name: status === 401 || status === 403 ? "workspace access" : "api",
            level: "fail",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return report(ctx.globals.json, checks);
    });
}

function report(json: boolean, checks: DoctorCheck[]): void {
  if (json) {
    printJson({ checks });
  } else {
    printLine(
      renderTable(
        checks.map((check) => ({
          status: check.level.toUpperCase(),
          check: check.name,
          detail: check.message,
        })),
        [
          { key: "status", header: "STATUS" },
          { key: "check", header: "CHECK" },
          { key: "detail", header: "DETAIL" },
        ],
      ),
    );
  }
  const failures = checks.filter((check) => check.level === "fail").length;
  if (failures > 0) {
    throw new CliError(`${failures} doctor check(s) failed`, 1);
  }
}

async function configMode(): Promise<number | null> {
  try {
    return (await stat(configPath())).mode & 0o777;
  } catch {
    return null;
  }
}
