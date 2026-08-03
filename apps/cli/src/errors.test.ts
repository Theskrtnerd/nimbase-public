import { describe, expect, it } from "vitest";

import { CliError, EXIT, notFound, usageError } from "./errors";

describe("CliError codes", () => {
  it("derives a stable code from the exit code", () => {
    expect(new CliError("x").code).toBe("runtime");
    expect(new CliError("x", EXIT.usage).code).toBe("usage");
    expect(new CliError("x", EXIT.notFound).code).toBe("not_found");
    expect(new CliError("x", EXIT.auth).code).toBe("auth_required");
  });

  it("lets an explicit code win over the derived one", () => {
    // 403 exits with the auth code but must not read as "log in again".
    const error = new CliError("x", EXIT.auth, { code: "forbidden" });
    expect(error.code).toBe("forbidden");
    expect(error.exitCode).toBe(EXIT.auth);
  });

  it("falls back to runtime for an exit code outside EXIT", () => {
    expect(new CliError("x", 42).code).toBe("runtime");
  });

  it("carries the upstream status for callers that branch on it", () => {
    // sync run relies on this to tell a missing connection from a real failure.
    expect(new CliError("x", 1, { httpStatus: 404 }).httpStatus).toBe(404);
  });
});

describe("error constructors", () => {
  // The inconsistency these fix: the same "doesn't exist" failure exited 1 from
  // removed commands and 2 from `workspace use`.
  it("gives every not-found the same exit code and code", () => {
    const error = notFound("No note with id x");
    expect(error.exitCode).toBe(EXIT.notFound);
    expect(error.code).toBe("not_found");
  });

  it("gives every usage error the same exit code and code", () => {
    const error = usageError("--limit must be an integer");
    expect(error.exitCode).toBe(EXIT.usage);
    expect(error.code).toBe("usage");
  });
});
