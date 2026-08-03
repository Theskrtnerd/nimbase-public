import { afterEach, beforeEach, expect, it } from "vitest";

import { resolveBaseUrl, resolveCredential } from "./credentials";

const ENV = { ...process.env };
beforeEach(() => {
  delete process.env.NIMBASE_TOKEN;
  delete process.env.NIMBASE_API_URL;
});
afterEach(() => {
  process.env = { ...ENV };
});

it("prefers NIMBASE_TOKEN env over a stored session token", () => {
  process.env.NIMBASE_TOKEN = "api-tok";
  expect(
    resolveCredential({ sessionToken: "sess", expiresAt: Infinity }),
  ).toEqual({ mode: "apiToken", token: "api-tok" });
});

it("uses a non-expired stored session token", () => {
  expect(
    resolveCredential({ sessionToken: "sess", expiresAt: Date.now() + 10_000 }),
  ).toEqual({ mode: "session", token: "sess" });
});

it("treats an expired session token as no credential", () => {
  expect(
    resolveCredential({ sessionToken: "sess", expiresAt: Date.now() - 1 }),
  ).toEqual({ mode: "none", token: null });
});

it("returns none when nothing is configured", () => {
  expect(resolveCredential({})).toEqual({ mode: "none", token: null });
});

it("resolves base URL: env > config > default", () => {
  expect(resolveBaseUrl({})).toBe("https://app.nimbase.ai");
  expect(resolveBaseUrl({ apiUrl: "http://cfg" })).toBe("http://cfg");
  process.env.NIMBASE_API_URL = "http://env";
  expect(resolveBaseUrl({ apiUrl: "http://cfg" })).toBe("http://env");
});
