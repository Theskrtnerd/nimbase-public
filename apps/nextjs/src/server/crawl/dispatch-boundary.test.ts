import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DISPATCHERS = ["dispatch.ts"] as const;

describe("crawl dispatcher import boundaries", () => {
  it("keeps Pi's expression-based Node imports outside the server bundle", () => {
    const nextConfig = readFileSync(
      join(import.meta.dirname, "../../../next.config.js"),
      "utf8",
    );

    expect(nextConfig).toContain(
      'serverExternalPackages: ["@earendil-works/pi-ai"]',
    );
  });

  it.each(DISPATCHERS)(
    "%s keeps production queue dispatch isolated from inline workers",
    (file) => {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");

      expect(source).not.toMatch(/from ["']@acme\/runtime["']/);
      expect(source).toMatch(/from ["']@acme\/runtime\/queue["']/);
      expect(source).not.toMatch(/^import \{ runCrawlJob \} from ["']\.\//m);
      expect(source).toMatch(/await import\(["']\.\//);
    },
  );
});
