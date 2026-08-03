/**
 * Process exit codes. `notFound` is its own code because "the thing you named
 * doesn't exist" is neither a usage mistake nor a runtime failure, and scripts
 * routinely want to branch on it. Before it existed, the same class of failure
 * exited 1 from some commands and 2 from others.
 */
export const EXIT = {
  runtime: 1,
  usage: 2,
  notFound: 3,
  auth: 4,
} as const;

/**
 * A stable machine-readable label for the failure, emitted as `error.code`
 * under `--json`. Agents and scripts branch on this; the human message is free
 * to be reworded without breaking them.
 */
export type CliErrorCode =
  | "auth_required"
  | "forbidden"
  | "not_found"
  | "usage"
  | "invalid_request"
  | "limit_reached"
  | "conflict"
  | "timeout"
  | "server_error"
  | "runtime";

// A Map, not a Record: `exitCode` is a plain number, so a caller passing a code
// outside EXIT must fall back rather than type as a known CliErrorCode.
const DEFAULT_CODE = new Map<number, CliErrorCode>([
  [EXIT.runtime, "runtime"],
  [EXIT.usage, "usage"],
  [EXIT.notFound, "not_found"],
  [EXIT.auth, "auth_required"],
]);

export interface CliErrorOptions {
  /** Overrides the code inferred from the exit code. */
  code?: CliErrorCode;
  /** Upstream HTTP status, when the failure came from the API. */
  httpStatus?: number;
}

/** A CLI-level error carrying the process exit code and a stable error code. */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly httpStatus?: number;

  constructor(
    message: string,
    readonly exitCode: number = EXIT.runtime,
    options: CliErrorOptions = {},
  ) {
    super(message);
    this.name = "CliError";
    this.code = options.code ?? DEFAULT_CODE.get(exitCode) ?? "runtime";
    this.httpStatus = options.httpStatus;
  }
}

/** The thing the user named does not exist (or isn't visible to them). */
export function notFound(message: string): CliError {
  return new CliError(message, EXIT.notFound, { code: "not_found" });
}

/** The invocation itself was wrong — bad flag, bad argument, nothing to do. */
export function usageError(message: string): CliError {
  return new CliError(message, EXIT.usage, { code: "usage" });
}
