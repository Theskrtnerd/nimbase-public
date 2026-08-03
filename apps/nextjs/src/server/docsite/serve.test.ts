import { describe, expect, it } from "vitest";

import { contentTypeFor, resolveAssetPath } from "./assets";
import { signBuildCallback, verifyBuildCallback } from "./runner";

describe("resolveAssetPath", () => {
  it("serves the site index at the root", () => {
    expect(resolveAssetPath([])).toBe("index.html");
  });

  it("treats an extensionless path as an Astro directory route", () => {
    expect(resolveAssetPath(["getting-started"])).toBe(
      "getting-started/index.html",
    );
    expect(resolveAssetPath(["guides", "install"])).toBe(
      "guides/install/index.html",
    );
  });

  it("serves files with extensions verbatim", () => {
    expect(resolveAssetPath(["_astro", "index.abc123.css"])).toBe(
      "_astro/index.abc123.css",
    );
    expect(resolveAssetPath(["llms.txt"])).toBe("llms.txt");
  });

  it("ignores empty segments from trailing slashes", () => {
    expect(resolveAssetPath(["guides", ""])).toBe("guides/index.html");
  });
});

describe("contentTypeFor", () => {
  it("maps the types a Nimbus build actually emits", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("a/b.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("a/b.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("fonts/inter.woff2")).toBe("font/woff2");
    expect(contentTypeFor("llms.txt")).toBe("text/plain; charset=utf-8");
    expect(contentTypeFor("sitemap.xml")).toBe(
      "application/xml; charset=utf-8",
    );
  });

  it("falls back rather than guessing", () => {
    expect(contentTypeFor("weird.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
  });
});

describe("build callback signatures", () => {
  const secret = "a-test-secret-at-least-32-chars-long";

  it("verifies a signature it issued", () => {
    const sig = signBuildCallback("build-1", secret);
    expect(verifyBuildCallback("build-1", sig, secret)).toBe(true);
  });

  it("rejects a signature for a different build", () => {
    const sig = signBuildCallback("build-1", secret);
    expect(verifyBuildCallback("build-2", sig, secret)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const sig = signBuildCallback(
      "build-1",
      "another-secret-32-chars-long!!!!",
    );
    expect(verifyBuildCallback("build-1", sig, secret)).toBe(false);
  });

  it("rejects malformed signatures without throwing", () => {
    expect(verifyBuildCallback("build-1", "", secret)).toBe(false);
    expect(verifyBuildCallback("build-1", "zz", secret)).toBe(false);
  });
});
