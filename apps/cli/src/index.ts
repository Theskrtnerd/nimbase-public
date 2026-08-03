import { CommanderError } from "commander";

import type { CliErrorCode } from "./errors";
import { CliError, EXIT } from "./errors";
import { buildProgram } from "./program";

/**
 * `--json` is read off argv rather than the parsed program: parsing itself is
 * what failed in some of these paths, so commander's option state may not exist
 * yet. `--json=true` is accepted alongside the bare flag so the two spellings
 * behave the same.
 */
const JSON_MODE =
  process.argv.includes("--json") || process.argv.includes("--json=true");

// Process entrypoint only. The command tree lives in ./program so tests (and
// any tooling) can import it without parsing argv or exiting the process.
async function main(): Promise<void> {
  const program = buildProgram({ json: JSON_MODE });
  await program.parseAsync(process.argv);
}

interface Failure {
  exitCode: number;
  /** Typed, not a bare string: this is the `error.code` scripts branch on. */
  code: CliErrorCode;
  message: string;
}

function describe(err: unknown): Failure {
  if (err instanceof CliError) {
    return { exitCode: err.exitCode, code: err.code, message: err.message };
  }
  if (err instanceof CommanderError) {
    // Every non-zero CommanderError is a parse failure — unknown command, bad
    // argument, missing required option — so it exits with the usage code
    // rather than commander's generic 1, matching the CLI's own usage errors.
    // Commander prefixes these with "error: "; strip it so the message reads
    // the same in both output modes.
    //
    // `commander.help` is the "you named a group but no command" case, where
    // commander's own message is the internal placeholder "(outputHelp)". It
    // prints the help text itself, so only the envelope needs real wording.
    return {
      exitCode: EXIT.usage,
      code: "usage",
      message:
        err.code === "commander.help"
          ? "No command given. Run `nimbase --help` to see the available commands."
          : err.message.replace(/^error: /, ""),
    };
  }
  return {
    exitCode: EXIT.runtime,
    code: "runtime",
    message: err instanceof Error ? err.message : String(err),
  };
}

main().catch((err: unknown) => {
  // `--help` and `--version` reach here as CommanderError with exit code 0
  // because of exitOverride. They already printed their output; leave quietly.
  if (err instanceof CommanderError && err.exitCode === 0) process.exit(0);

  const failure = describe(err);
  if (JSON_MODE) {
    // Errors go to stderr in both modes, so stdout stays a single parseable
    // JSON document under `--json` whether the command succeeded or not.
    process.stderr.write(
      `${JSON.stringify({ error: { code: failure.code, message: failure.message } }, null, 2)}\n`,
    );
  } else if (!(err instanceof CommanderError)) {
    // Commander already wrote its own message (plus any "did you mean"
    // suggestion) to stderr in human mode — re-printing would duplicate it.
    process.stderr.write(`${failure.message}\n`);
  }
  process.exit(failure.exitCode);
});
