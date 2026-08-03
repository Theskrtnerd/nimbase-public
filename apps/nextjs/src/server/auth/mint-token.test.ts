import { describe, expect, it } from "vitest";

import { hashApiToken } from "./api-token";
import { generateRawToken } from "./mint-token";

describe("token mint primitives", () => {
  it("generates url-safe tokens with sufficient entropy", () => {
    const token = generateRawToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes a token to 64 hex chars", () => {
    expect(hashApiToken(generateRawToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is unique across calls", () => {
    expect(generateRawToken()).not.toBe(generateRawToken());
  });
});
