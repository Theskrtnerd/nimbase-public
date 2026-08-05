import { describe, expect, it } from "vitest";

import {
  artifactGenerateJobSchema,
  brainInitJobSchema,
  compileJobSchema,
  crawlJobSchema,
  extractJobSchema,
} from "./queue";

// These schemas are the wire contract for every QStash job: the publisher sends
// the object and the worker route parses it with the same schema. A field that
// exists on the payload but not on the schema is silently stripped, so the
// round-trip below is the property that actually matters.
describe("job payload schemas round-trip every field", () => {
  it("preserves the read-scope snapshot on an artifact generate job", () => {
    const payload = {
      jobId: "j1",
      artifactId: "a1",
      workspaceId: "w1",
      prompt: "quarterly numbers",
      kind: "fixed" as const,
      themeMode: "app" as const,
      readScopes: [{ prefix: "team", exclude: ["team/private"] }],
    };

    expect(artifactGenerateJobSchema.parse(payload)).toEqual(payload);
  });

  it("round-trips a canonical compile job", () => {
    const payload = { jobId: "j1", workspaceId: "w1", sourceId: "s1" };
    expect(compileJobSchema.parse(payload)).toEqual(payload);
  });

  it("round-trips the remaining job payloads", () => {
    const extract = { jobId: "j1", workspaceId: "w1", sourceId: "s1" };
    expect(extractJobSchema.parse(extract)).toEqual(extract);

    const crawl = {
      jobId: "connector-pull-1",
      runId: "00000000-0000-4000-8000-000000000001",
      connectionId: "c1",
      workspaceId: "w1",
    };
    expect(crawlJobSchema.parse(crawl)).toEqual(crawl);

    const brain = {
      jobId: "j1",
      workspaceId: "w1",
      websiteUrl: "https://example.com",
      identitySource: "website",
      identitySources: { title: "manual", description: "website" },
    };
    expect(brainInitJobSchema.parse(brain)).toEqual(brain);
  });
});
