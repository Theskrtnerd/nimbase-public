import type { Command } from "commander";

import type { ConnectionSummary } from "@acme/validators/cli";
import {
  connectionScopesResponseSchema,
  connectionsResponseSchema,
  connectorRegistrationResponseSchema,
} from "@acme/validators/cli";

import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { usageError } from "../../errors";
import { printJson, printLine, renderTable } from "../../output";
import { resolveWorkspace, workspaceScope } from "../../workspace";
import { registerSyncGet } from "./get";
import { registerSyncRun } from "./run";

interface AddOptions {
  config?: string;
  folder?: string;
  interval?: string;
  name?: string;
  secretEnv?: string;
}

export function registerSync(program: Command): void {
  const sync = program
    .command("sync")
    .description("Register and synchronize standing knowledge connectors");

  sync
    .command("providers")
    .description("List managed connectors advertised by this Nimbase server")
    .action(async (_options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const response = await ctx.client.request("GET", "/api/connections", {
        query: { workspaceId },
        schema: connectionsResponseSchema,
      });
      if (ctx.globals.json) {
        printJson({ providers: response.providers });
        return;
      }
      if (response.providers.length === 0) {
        printLine(
          "No managed connectors are advertised. Register an external connector with `nimbase sync add <url>`.",
        );
        return;
      }
      printLine(
        renderTable(
          response.providers.map((provider) => ({
            provider: provider.provider,
            status: provider.configured ? "available" : "not configured",
            label: provider.label,
          })),
          [
            { key: "provider", header: "PROVIDER" },
            { key: "status", header: "STATUS" },
            { key: "label", header: "NAME" },
          ],
        ),
      );
    });

  sync
    .command("add")
    .description("Register an out-of-process Nimbase connector")
    .argument("<connectorUrl>", "connector base URL")
    .option(
      "--secret-env <name>",
      "read the connector bearer secret from an environment variable",
    )
    .option("--config <json>", "connector configuration as a JSON object", "{}")
    .option("--name <name>", "display name for this connection")
    .option("--folder <uuid>", "target Nimbase folder id (omit for root)")
    .option(
      "--interval <seconds>",
      "automatic sync interval in seconds (300-2592000)",
      "86400",
    )
    .action(
      async (connectorUrl: string, options: AddOptions, command: Command) => {
        const intervalSeconds = parseInterval(options.interval);
        const configuration = parseConnectorConfig(options.config ?? "{}");
        const secret = options.secretEnv
          ? process.env[options.secretEnv]
          : undefined;
        if (options.secretEnv && !secret) {
          throw usageError(
            `environment variable ${options.secretEnv} is not set`,
          );
        }
        let endpointUrl: string;
        try {
          endpointUrl = new URL(connectorUrl).toString();
        } catch {
          throw usageError("connectorUrl must be an absolute URL");
        }

        const ctx = await createContext(command);
        requireSession(ctx.config, "`nimbase sync add`");
        const workspaceId = await resolveWorkspace(ctx);
        const result = await ctx.client.request("POST", "/api/connections", {
          body: {
            workspaceId,
            endpointUrl,
            secret: secret ?? null,
            displayName: options.name ?? null,
            targetFolderId: options.folder ?? null,
            intervalSeconds,
            configuration,
          },
          schema: connectorRegistrationResponseSchema,
        });
        if (ctx.globals.json) {
          printJson(result);
          return;
        }
        printLine(`Connected ${result.label}. id ${result.connectionId}`);
        if (result.supportsScopes) {
          printLine(
            `List available scopes with \`nimbase sync scopes ${result.connectionId}\`, then configure them with \`nimbase sync configure ${result.connectionId} --scope <id...>\`.`,
          );
        } else {
          printLine(
            `Run \`nimbase sync run ${result.connectionId}\` to sync now.`,
          );
        }
      },
    );

  sync
    .command("scopes")
    .description("List selectable scopes exposed by a connector")
    .argument("<connectionId>", "connection id")
    .action(
      async (connectionId: string, _options: unknown, command: Command) => {
        const { ctx, workspaceId } = await workspaceScope(command);
        const result = await ctx.client.request(
          "GET",
          `/api/connections/${connectionId}/scopes`,
          {
            query: { workspaceId },
            schema: connectionScopesResponseSchema,
          },
        );
        if (ctx.globals.json) {
          printJson(result);
          return;
        }
        if (!result.scopeKind) {
          printLine(`${result.provider} has no configurable scopes.`);
          return;
        }
        if (result.scopes.length === 0) {
          printLine(`No ${result.scopeKind}s available.`);
          return;
        }
        printLine(
          renderTable(
            result.scopes.map((scope) => ({
              selected: scope.selected ? "*" : "",
              name: scope.path ?? scope.name,
              id: scope.id,
            })),
            [
              { key: "selected", header: "" },
              { key: "name", header: result.scopeKind.toUpperCase() },
              { key: "id", header: "ID" },
            ],
          ),
        );
      },
    );

  sync
    .command("configure")
    .description("Choose the scopes a connection watches")
    .argument("<connectionId>", "connection id")
    .requiredOption("--scope <id...>", "one or more scope ids")
    .action(
      async (
        connectionId: string,
        options: { scope: string[] },
        command: Command,
      ) => {
        const { ctx, workspaceId } = await workspaceScope(command);
        const result = await ctx.client.request(
          "PATCH",
          `/api/connections/${connectionId}/scopes`,
          {
            body: { workspaceId, scopeIds: options.scope },
            schema: connectionScopesResponseSchema,
          },
        );
        if (ctx.globals.json) {
          printJson(result);
          return;
        }
        printLine(
          `Configured ${result.provider} with ${result.scopes.filter((scope) => scope.selected).length} selected ${result.scopeKind ?? "scope"}(s).`,
        );
        printLine(`Run \`nimbase sync run ${connectionId}\` to sync now.`);
      },
    );

  sync
    .command("list")
    .description("List connections and their sync health")
    .action(async (_options: unknown, command: Command) => {
      const { ctx, workspaceId } = await workspaceScope(command);
      const response = await ctx.client.request("GET", "/api/connections", {
        query: { workspaceId },
        schema: connectionsResponseSchema,
      });
      if (ctx.globals.json) {
        printJson({ connections: response.connections });
        return;
      }
      printConnections(response.connections);
    });

  registerSyncGet(sync);
  registerSyncRun(sync);
}

export function parseConnectorConfig(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw usageError("--config must be valid JSON");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw usageError("--config must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function parseInterval(value = "86400"): number {
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 300 || interval > 2_592_000) {
    throw usageError("--interval must be an integer between 300 and 2592000");
  }
  return interval;
}

function printConnections(connections: ConnectionSummary[]): void {
  if (connections.length === 0) {
    printLine("No connections.");
    return;
  }
  printLine(
    renderTable(
      connections.map((connection) => ({
        provider: connection.provider,
        name: connection.displayName ?? "",
        status: connection.status,
        lastSync: connection.lastSuccessAt ?? "never",
        id: connection.id,
      })),
      [
        { key: "provider", header: "CONNECTOR" },
        { key: "name", header: "NAME" },
        { key: "status", header: "STATUS" },
        { key: "lastSync", header: "LAST SUCCESS" },
        { key: "id", header: "ID" },
      ],
    ),
  );
}
