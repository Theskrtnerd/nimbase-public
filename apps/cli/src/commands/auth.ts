import type { Command } from "commander";

import {
  identityResponseSchema,
  workspaceListResponseSchema,
} from "@acme/validators/cli";

import { saveConfig } from "../config";
import { createContext } from "../context";
import { resolveCredential } from "../credentials";
import { CliError, EXIT } from "../errors";
import { login } from "../login";
import { printJson, printLine } from "../output";

export function registerAuth(program: Command): void {
  const auth = program
    .command("auth")
    .description("Sign in and inspect your identity");

  auth
    .command("login")
    .description("Sign in through your browser")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      const user = await login(ctx.baseUrl);
      if (ctx.globals.json) printJson({ ok: true, user });
      else printLine(`Logged in as ${user.name ?? user.email ?? user.id}`);
    });

  auth
    .command("logout")
    .description("Clear the stored session token")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      await saveConfig({
        ...ctx.config,
        sessionToken: undefined,
        expiresAt: undefined,
      });
      if (ctx.globals.json) printJson({ ok: true });
      else printLine("Logged out");
    });

  auth
    .command("whoami")
    .description("Show the current identity and default workspace")
    .action(async (_options: unknown, command: Command) => {
      const ctx = await createContext(command);
      const cred = resolveCredential(ctx.config);
      if (cred.mode === "none") {
        throw new CliError(
          "Not authenticated. Run `nimbase auth login`.",
          EXIT.auth,
          { code: "auth_required" },
        );
      }
      if (cred.mode === "apiToken") {
        if (ctx.globals.json) printJson({ mode: "automation" });
        else printLine("Authenticated with an automation credential");
        return;
      }
      // Session: naming the person is the point of `whoami`, and both calls
      // also prove the stored token still works.
      const [identity, { workspaces }] = await Promise.all([
        ctx.client.request("GET", "/api/me", {
          schema: identityResponseSchema,
        }),
        ctx.client.request("GET", "/api/workspaces", {
          schema: workspaceListResponseSchema,
        }),
      ]);
      const defaultId = ctx.config.defaultWorkspaceId;
      const defaultWorkspace = workspaces.find(
        (workspace) => workspace.id === defaultId,
      );
      if (ctx.globals.json) {
        printJson({
          mode: "session",
          user: identity,
          expiresAt: ctx.config.expiresAt ?? null,
          defaultWorkspaceSlug: defaultWorkspace?.slug ?? null,
          workspaces: workspaces.map((workspace) => ({
            name: workspace.name,
            slug: workspace.slug,
          })),
        });
        return;
      }
      const who = identity.name ?? identity.email ?? identity.id;
      printLine(
        `${who}${identity.name && identity.email ? ` <${identity.email}>` : ""}`,
      );
      printLine(`Session · ${workspaces.length} workspace(s)`);
      if (ctx.config.expiresAt) {
        printLine(
          `Session expires: ${new Date(ctx.config.expiresAt).toISOString()}`,
        );
      }
      if (defaultId) {
        // A default that no longer resolves is the exact state that used to
        // surface later as a confusing "not authenticated" error.
        printLine(
          defaultWorkspace
            ? `Default workspace: ${defaultWorkspace.slug}`
            : `Default workspace: unavailable (stored id ${defaultId} is not one of yours — run \`nimbase workspace use <slug>\`)`,
        );
      }
    });
}
