import { describe, expect, it } from "vitest";

import { isAllowedRedirect } from "./allowed-redirect";

describe("isAllowedRedirect", () => {
  it("allows nimbase:// custom scheme", () => {
    expect(isAllowedRedirect("nimbase://auth/callback")).toBe(true);
  });
  it("allows https *.chromiumapp.org (extension identity redirect)", () => {
    expect(isAllowedRedirect("https://abcdef.chromiumapp.org/")).toBe(true);
  });
  it("rejects arbitrary https origins", () => {
    expect(isAllowedRedirect("https://evil.example.com/")).toBe(false);
  });
  it("rejects http chromiumapp.org (must be https)", () => {
    expect(isAllowedRedirect("http://abc.chromiumapp.org/")).toBe(false);
  });
  it("rejects a hostname that merely contains chromiumapp.org", () => {
    expect(isAllowedRedirect("https://chromiumapp.org.evil.com/")).toBe(false);
  });
  it("rejects garbage", () => {
    expect(isAllowedRedirect("not a url")).toBe(false);
  });
  it("allows http loopback redirects (CLI, RFC 8252)", () => {
    expect(isAllowedRedirect("http://127.0.0.1:51234/callback")).toBe(true);
    expect(isAllowedRedirect("http://localhost:8976/cb")).toBe(true);
  });
  it("rejects http on non-loopback hosts", () => {
    expect(isAllowedRedirect("http://example.com/cb")).toBe(false);
    expect(isAllowedRedirect("http://127.0.0.1.evil.com/cb")).toBe(false);
    expect(isAllowedRedirect("http://localhost.evil.com/cb")).toBe(false);
  });
});
