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
  runGardener: vi.fn(),
  runGardenerHarness: vi.fn(),
  resolveModels: vi.fn(),
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
// The harness twin is stubbed; harnessEnabledFor stays real (env-driven).
vi.mock("../harness", async (importOriginal) => {
  const actual = await importOriginal<typeof HarnessModule>();
  return {
    ...actual,
    runGardenerHarness: mocks.runGardenerHarness,
  };
});
// reconcile resolves its own model through the central AI layer.
vi.mock("../ai", () => ({ resolveModels: mocks.resolveModels }));
// Keep the pure helpers (normalizeTitle, the codec) real; only the FS + gardener
// are stubbed.
vi.mock("./wiki", async (importOriginal) => {
  const actual = await importOriginal<typeof Wiki>();
  return {
    ...actual,
    GardenerFs: { forScopes: mocks.forScopes },
    runGardener: mocks.runGardener,
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
  mocks.resolveModels.mockResolvedValue({
    chat: { id: "test-model-id", model: "test-model" },
  });
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

  it("runs the gardener with the candidate + fence + resolved model, types the outcome", async () => {
    mocks.runGardener.mockResolvedValue({
      report: "merged the launch date",
      usage: { inputTokens: 5, outputTokens: 2 },
      ops: [{ op: "update", kind: "note", path: "sales/q3.md", nodeId: "n1" }],
    });

    const result = await new WikiPgProvider().reconcile(
      makeCtx(),
      { sourceKind: "web", title: "Launch", content: "launch moved to Q3" },
      OPTS,
    );

    // The model is resolved by the provider, not passed in.
    expect(mocks.resolveModels).toHaveBeenCalledWith("ws1");
    expect(mocks.runGardener).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws1",
        sourceId: "src1",
        jobId: "job1",
        sourceKind: "web",
        sourceTitle: "Launch",
        rawText: "launch moved to Q3",
        fence: OPTS.fence,
        chatModel: "test-model",
        chatModelId: "test-model-id",
      }),
    );
    expect(result).toEqual({
      action: "merge",
      nodeId: "n1",
      report: "merged the launch date",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });

  it("routes through the Pi-harness gardener when the flag lists it", async () => {
    process.env.NIMBASE_HARNESS_SURFACES = "gardener";
    try {
      mocks.runGardenerHarness.mockResolvedValue({
        report: "harness merged it",
        usage: { inputTokens: 3, outputTokens: 4 },
        ops: [
          { op: "update", kind: "note", path: "sales/q3.md", nodeId: "n1" },
        ],
      });

      const result = await new WikiPgProvider().reconcile(
        makeCtx(),
        { sourceKind: "web", title: "Launch", content: "launch moved to Q3" },
        OPTS,
      );

      expect(mocks.runGardener).not.toHaveBeenCalled();
      expect(mocks.runGardenerHarness).toHaveBeenCalledWith({
        workspaceId: "ws1",
        sourceId: "src1",
        jobId: "job1",
        sourceKind: "web",
        sourceTitle: "Launch",
        rawText: "launch moved to Q3",
        fence: OPTS.fence,
        // no company.md in the mocked wiki → best-effort load yields null
        companyContext: null,
      });
      expect(result).toEqual({
        action: "merge",
        nodeId: "n1",
        report: "harness merged it",
        usage: { inputTokens: 3, outputTokens: 4 },
      });
    } finally {
      delete process.env.NIMBASE_HARNESS_SURFACES;
    }
  });

  it("types a merge-then-delete run as supersede", async () => {
    mocks.runGardener.mockResolvedValue({
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
