import { describe, expect, it } from "vitest";

import { hashApiToken, verifyApiToken } from "./api-token";

describe("hashApiToken", () => {
  it("is deterministic and hex-encoded", () => {
    const a = hashApiToken("nimbase_sk_test");
    const b = hashApiToken("nimbase_sk_test");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("differs for different inputs", () => {
    expect(hashApiToken("a")).not.toBe(hashApiToken("b"));
  });
});

// These branches return before touching the database, so they're unit-testable
// without a DB connection. The hash-lookup path is covered by the Task 12 smoke test.
describe("verifyApiToken (pre-DB header parsing)", () => {
  it("returns null when the header is missing", async () => {
    expect(await verifyApiToken(null)).toBeNull();
  });
  it("returns null for a non-Bearer scheme", async () => {
    expect(await verifyApiToken("Token abc123")).toBeNull();
  });
  it("returns null when the bearer value is empty", async () => {
    expect(await verifyApiToken("Bearer    ")).toBeNull();
  });
});
