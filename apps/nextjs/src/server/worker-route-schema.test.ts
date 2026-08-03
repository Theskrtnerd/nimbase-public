import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every QStash worker route used to hand-write a zod mirror of the *JobData
// interface its publisher sends. Nothing enforced that the mirror was complete,
// and zod strips unknown keys on parse. A field missing from the mirror was
// therefore dropped silently in production while dev, which never round-trips
// through the schema, kept working.
//
// The fix is that the publisher's schema IS the parser. This test keeps it that
// way — a reintroduced local `z.object` for the body would restore the drift.
const WORKER_ROUTES = [
  ["compile/route.ts", "compileJobSchema"],
  ["extract/route.ts", "extractJobSchema"],
  ["crawl/route.ts", "crawlJobSchema"],
  ["artifacts/generate/route.ts", "artifactGenerateJobSchema"],
  ["brain/init/route.ts", "brainInitJobSchema"],
  ["agents/turn/route.ts", "agentTurnJobSchema"],
  ["docsites/generate/route.ts", "docSiteBuildJobSchema"],
] as const;

const API_DIR = join(import.meta.dirname, "../app/api");

describe("QStash worker route body schemas", () => {
  it.each(WORKER_ROUTES)(
    "%s parses with the publisher's schema rather than a local mirror",
    (file, schemaName) => {
      const source = readFileSync(join(API_DIR, file), "utf8");

      expect(source).toMatch(
        new RegExp(
          `import \\{ ${schemaName} \\} from ["']@acme/cloud/queue["']`,
        ),
      );
      expect(source).toContain(`const Body = ${schemaName};`);
      // A local z.object for the body is the drift this test exists to stop.
      expect(source).not.toMatch(/const Body = z\.object\(/);
    },
  );

  it.each(WORKER_ROUTES)("%s still verifies the QStash signature", (file) => {
    const source = readFileSync(join(API_DIR, file), "utf8");
    expect(source).toContain("export const POST = verifyQstashSignature(");
  });
});
