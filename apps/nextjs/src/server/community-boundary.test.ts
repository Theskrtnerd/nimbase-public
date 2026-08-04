import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");

const MANAGED_PATHS = [
  "apps/nextjs/src/app/admin",
  "apps/nextjs/src/app/api/agents/slack",
  "apps/nextjs/src/app/api/agents/turn",
  "apps/nextjs/src/app/api/agents/webhooks",
  "apps/nextjs/src/app/api/billing",
  "apps/nextjs/src/app/api/deployments/docs",
  "apps/nextjs/src/app/api/docs-site",
  "apps/nextjs/src/app/api/docsites",
  "apps/nextjs/src/app/api/stripe",
  "apps/nextjs/src/app/api/workspaces/plan",
  "apps/nextjs/src/server/billing",
  "apps/nextjs/src/server/docsite",
  "packages/api/src/router/operator.ts",
  "packages/api/src/router/billing.ts",
  "packages/api/src/router/doc-site.ts",
] as const;

const COMMUNITY_CORE_PATHS = [
  "apps/nextjs/src/app/api/compile/route.ts",
  "apps/nextjs/src/app/api/crawl/route.ts",
  "apps/nextjs/src/app/api/crawl/scheduler/route.ts",
  "apps/nextjs/src/app/api/group-mcp/[orgSlug]/[groupSlug]/route.ts",
  "apps/nextjs/src/server/crawl/remote-connector.ts",
  "packages/cloud/src/harness/index.ts",
  "packages/cloud/src/harness/wiki-file-system.ts",
  "packages/cloud/src/memory/wiki/vfs.ts",
  "packages/connector-sdk/src/index.ts",
] as const;

function containsImplementation(path: string): boolean {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) return false;
  if (statSync(absolute).isFile()) return true;
  return readdirSync(absolute).some((entry) =>
    containsImplementation(join(path, entry)),
  );
}

describe("Community server boundary", () => {
  it.each(MANAGED_PATHS)("does not ship managed implementation %s", (path) => {
    expect(containsImplementation(path)).toBe(false);
  });

  it.each(COMMUNITY_CORE_PATHS)("keeps self-hosted core %s", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(true);
  });

  it("does not validate managed runtime credentials", () => {
    const envSource = readFileSync(
      join(ROOT, "apps/nextjs/src/env.ts"),
      "utf8",
    );
    expect(envSource).not.toMatch(
      /(?:STRIPE_|SLACK_|DOCS_BUILDER_|NIMBASE_DOCS_HOST|GODS)/,
    );
  });
});
