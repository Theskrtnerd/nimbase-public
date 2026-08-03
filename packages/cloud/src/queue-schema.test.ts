import { describe, expect, it } from "vitest";

import {
  agentTurnJobSchema,
  artifactGenerateJobSchema,
  brainInitJobSchema,
  compileJobSchema,
  crawlJobSchema,
  docSiteBuildJobSchema,
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

    const turn = {
      jobId: "j1",
      connectionId: "c1",
      threadId: "slack:C123:1699.99",
      userText: "hi",
      externalUserId: "U1",
    };
    expect(agentTurnJobSchema.parse(turn)).toEqual(turn);

    const brain = {
      jobId: "j1",
      workspaceId: "w1",
      websiteUrl: "https://example.com",
      identitySource: "website",
      identitySources: { title: "manual", description: "website" },
    };
    expect(brainInitJobSchema.parse(brain)).toEqual(brain);

    const docSite = {
      jobId: "j1",
      buildId: "b1",
      docSiteId: "d1",
      workspaceId: "w1",
    };
    expect(docSiteBuildJobSchema.parse(docSite)).toEqual(docSite);
  });

  it("carries no fence on a docs-site build job", () => {
    // The fence is derived from the site's optional folder anchor at job time,
    // never sent. A caller able to enqueue cannot choose the published scope.
    const parsed: Record<string, unknown> = docSiteBuildJobSchema.parse({
      jobId: "j1",
      buildId: "b1",
      docSiteId: "d1",
      workspaceId: "w1",
      readScopes: null,
      folderId: "folder-1",
    });
    expect(parsed.readScopes).toBeUndefined();
    expect(parsed.folderId).toBeUndefined();
  });
});
