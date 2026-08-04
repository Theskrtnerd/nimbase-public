// Write-side MemoryProvider behavior (upsert + reconcile) with the VFS, the
// gardener, and the DB faked. Kept separate from wiki-pg-provider.test.ts so
// this file can fake @acme/db/client + @acme/db/node-metadata + ./wiki without
// disturbing that file's read-side gate/helper tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PathScope } from "@acme/db";
import type { GrantRole } from "@acme/db/schema";

import type * as HarnessModule from "../harness";
import type * as Wiki from "./wiki";
import { toProviderContext } from "./context";
import { parseOkf } from "./okf/codec";
import { WikiPgProvider } from "./wiki-pg-provider";

const mocks = vi.hoisted(() => ({
  forScopes: vi.fn(),
  runGardenerHarness: vi.fn(),
  write: vi.fn(),
  selectNode: vi.fn(),
  selectVersion: vi.fn(),
  getObjectText: vi.fn(),
  loadNodeSources: vi.fn(),
  loadNodeTags: vi.fn(),
}));

vi.mock("@acme/db", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@acme/db/schema", () => ({
  WikiNode: { __table: "wiki_node" },
  WikiNodeVersion: { __table: "wiki_node_version" },
}));
// loadNodeByPath issues two selects: WikiNode then WikiNodeVersion. Dispatch by
// table identity so each returns its own row.
vi.mock("@acme/db/client", async () => {
  const schema = await import("@acme/db/schema");
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => ({
            limit:
              table === schema.WikiNode
                ? mocks.selectNode
                : mocks.selectVersion,
          })),
        })),
      })),
    },
  };
});
vi.mock("@acme/db/node-metadata", () => ({
  loadNodeSources: mocks.loadNodeSources,
  loadNodeTags: mocks.loadNodeTags,
}));
vi.mock("../s3", () => ({ getObjectText: mocks.getObjectText }));
// The harness gardener is the only reconcile runner.
vi.mock("../harness", async (importOriginal) => {
  const actual = await importOriginal<typeof HarnessModule>();
  return {
    ...actual,
    runGardenerHarness: mocks.runGardenerHarness,
  };
});
// Keep the pure helpers (normalizeTitle, the codec) real; only the FS is
// stubbed.
vi.mock("./wiki", async (importOriginal) => {
  const actual = await importOriginal<typeof Wiki>();
  return {
    ...actual,
    GardenerFs: { forScopes: mocks.forScopes },
  };
});

const ROOT: PathScope[] = [{ prefix: "", exclude: [] }];

function makeCtx(capture: PathScope[] | null = ROOT) {
  const byRole: Record<GrantRole, PathScope[] | null> = {
    viewer: ROOT,
    contributor: capture,
    manager: [],
  };
  return toProviderContext({
    workspaceId: "ws1",
    userId: "user1",
    scopes: (minRole: GrantRole) => byRole[minRole],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forScopes.mockReturnValue({
    write: mocks.write,
  });
  mocks.write.mockResolvedValue('created "inbox/n.md"');
  mocks.selectNode.mockResolvedValue([
    {
      id: "n1",
      path: "inbox/n.md",
      title: "My Note",
      currentVersionId: "v1",
    },
  ]);
  mocks.selectVersion.mockResolvedValue([{ s3Key: "k1", summary: "sum" }]);
  mocks.getObjectText.mockResolvedValue("stored body");
  mocks.loadNodeSources.mockResolvedValue([]);
  mocks.loadNodeTags.mockResolvedValue([]);
});

describe("WikiPgProvider.upsert", () => {
  it("requires an explicit path", async () => {
    await expect(
      new WikiPgProvider().upsert(makeCtx(), {
        kind: "note",
        title: "t",
        content: "c",
      }),
    ).rejects.toThrow(/explicit metadata path/);
  });

  it("writes a note through the FS with the title folded into the body", async () => {
    const node = await new WikiPgProvider().upsert(makeCtx(), {
      kind: "note",
      title: "My Note",
      content: "hello",
      path: "inbox/n.md",
    });

    // Fenced to the caller's capture scopes, no originating source/job.
    expect(mocks.forScopes).toHaveBeenCalledWith("ws1", null, null, ROOT);
    const [path, body, summary] = mocks.write.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(path).toBe("inbox/n.md");
    expect(summary).toBe("My Note");
    const parsed = parseOkf(body);
    expect(parsed.meta.title).toBe("My Note");
    expect(parsed.content).toBe("hello\n");
    // Returns the assembled node re-read by path.
    expect(node.id).toBe("n1");
    expect(node.content).toBe("stored body");
  });

  it("uses the summary override as the note's tree summary when given", async () => {
    await new WikiPgProvider().upsert(makeCtx(), {
      kind: "note",
      title: "My Note",
      content: "hello",
      path: "inbox/n.md",
      summary: "a crisp one-liner",
    });
    const body = mocks.write.mock.calls[0]?.[1] as string;
    expect(parseOkf(body).meta.title).toBe("My Note");
    expect(mocks.write).toHaveBeenCalledWith(
      "inbox/n.md",
      body,
      "a crisp one-liner",
    );
  });

  it("stamps type: Dataset on a dataset upsert and routes it through write", async () => {
    await new WikiPgProvider().upsert(makeCtx(), {
      kind: "dataset",
      title: "Data",
      content: "| a |\n|---|\n| 1 |\n",
      path: "data/x.md",
      summary: "rows",
    });
    const [path, body, summary] = mocks.write.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(path).toBe("data/x.md");
    expect(summary).toBe("rows");
    expect(body).toContain("type: Dataset");
    expect(body).toContain("title: Data");
    expect(body).toContain("| a |");
  });

  it("stamps a caller-declared OKF type (Company Profile)", async () => {
    await new WikiPgProvider().upsert(makeCtx(), {
      kind: "note",
      type: "Company Profile",
      title: "Acme",
      content: "# Acme\n",
      path: "company.md",
      summary: "root note",
    });
    const body = mocks.write.mock.calls[0]?.[1] as string;
    expect(body).toContain("type: Company Profile");
    expect(body).toContain("title: Acme");
  });
});

describe("WikiPgProvider.reconcile", () => {
  const OPTS = {
    sourceId: "src1",
    jobId: "job1",
    fence: { prefix: "sales", exclude: [] },
  };

  it("runs the harness gardener with the candidate and fence, then types the outcome", async () => {
    mocks.runGardenerHarness.mockResolvedValue({
      report: "merged the launch date",
      usage: { inputTokens: 5, outputTokens: 2 },
      ops: [{ op: "update", kind: "note", path: "sales/q3.md", nodeId: "n1" }],
    });

    const result = await new WikiPgProvider().reconcile(
      makeCtx(),
      { sourceKind: "web", title: "Launch", content: "launch moved to Q3" },
      OPTS,
    );

    expect(mocks.runGardenerHarness).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws1",
        sourceId: "src1",
        jobId: "job1",
        sourceKind: "web",
        sourceTitle: "Launch",
        rawText: "launch moved to Q3",
        fence: OPTS.fence,
      }),
    );
    expect(result).toEqual({
      action: "merge",
      nodeId: "n1",
      report: "merged the launch date",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });

  it("types a merge-then-delete run as supersede", async () => {
    mocks.runGardenerHarness.mockResolvedValue({
      report: "merged dup into survivor",
      usage: { inputTokens: 1, outputTokens: 1 },
      ops: [
        { op: "update", kind: "note", path: "sales/q3.md", nodeId: "survivor" },
        { op: "delete", path: "sales/dup.md", nodeIds: ["dup"] },
      ],
    });

    const result = await new WikiPgProvider().reconcile(
      makeCtx(),
      { sourceKind: "web", title: "T", content: "c" },
      OPTS,
    );

    expect(result).toMatchObject({
      action: "supersede",
      nodeId: "survivor",
      supersededIds: ["dup"],
    });
  });
});
