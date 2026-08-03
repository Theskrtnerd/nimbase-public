import { Command } from "commander";

import { registerAuth } from "./commands/auth";
import { registerDeploy } from "./commands/deploy";
import { registerDoctor } from "./commands/doctor";
import { registerMemory } from "./commands/memory";
import { registerSync } from "./commands/sync";
import { registerWorkspace } from "./commands/workspace";
import { CLI_VERSION } from "./version";

export function buildProgram(options: { json?: boolean } = {}): Command {
  const program = new Command();
  // Set before the subcommands are registered: commander copies these settings
  // to each child at creation time. exitOverride routes commander's own parse
  // failures (unknown command, missing required option) through the
  // entrypoint's handler instead of exiting mid-parse, which is what lets
  // `--json` render them as an error envelope too.
  program.exitOverride();
  if (options.json) {
    // Commander would otherwise write its plain-text "error: ..." to stderr
    // alongside the JSON envelope. The entrypoint re-emits the same failure.
    program.configureOutput({ writeErr: () => undefined });
  }
  program
    .name("nimbase")
    .description(
      "Nimbase CLI — connect, capture, govern, and deploy company memory",
    )
    .version(CLI_VERSION)
    .option("--json", "machine-readable JSON output")
    .option("--workspace <slug>", "use a workspace by slug");

  registerAuth(program);
  registerWorkspace(program);
  registerSync(program);
  registerMemory(program);
  registerDeploy(program);
  registerDoctor(program);
  return program;
}
