import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PathScope } from "@acme/db";

import { GardenerFs, VfsError } from "./vfs";

const mocks = vi.hoisted(() => ({
  selectRows: vi.fn(),
  selectGrantRows: vi.fn(),
  selectSourceRows: vi.fn(),
  getObjectText: vi.fn(),
  putObject: vi.fn(),
  insertMutationValues: vi.fn(),
  insertTagRows: vi.fn(),
  insertSourceValues: vi.fn(),
  insertSourceOnConflict: vi.fn(),
  deleteWhere: vi.fn(),
  updateSet: vi.fn(),
  batch: vi.fn(),
  indexNodeVersion: vi.fn(),
  loadNodeSources: vi.fn(),
  notifyMemoryGitProjection: vi.fn(),
}));

vi.mock("@acme/db", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  like: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@acme/db/schema", () => ({
  WikiNode: { path: "path", id: "id", restricted: "restricted" },
  WikiNodeVersion: {},
  MemoryMutation: {},
  WikiNodeTag: { nodeId: "nodeId", tag: "tag", workspaceId: "workspaceId" },
  WikiNodeSource: {
    nodeId: "nodeId",
    sourceId: "sourceId",
    workspaceId: "workspaceId",
  },
  Source: { id: "id", workspaceId: "workspaceId" },
  AccessGrant: { folderId: "folderId" },
  Workspace: { id: "workspaceId" },
}));

// db mock: select().from() dispatches by table identity so each caller gets
// the right mock chain — WikiNode/WikiNodeVersion go through leftJoin
// (listNodes) or where().limit() (AccessGrant checks); Source (citeSources'
// validation query) goes through a bare where() awaited directly. insert()
// dispatches similarly: MemoryMutation records its values, WikiNodeSource gets
// an onConflictDoNothing chain, and WikiNodeTag a bare values().
vi.mock("@acme/db/client", async () => {
  const schema = await import("@acme/db/schema");
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          if (table === schema.Workspace) {
            return {
              where: vi.fn(() => ({ for: vi.fn() })),
            };
          }
          if (table === schema.Source) {
            return { where: mocks.selectSourceRows };
          }
          return {
            leftJoin: vi.fn(() => ({ where: mocks.selectRows })),
            where: vi.fn(() => ({ limit: mocks.selectGrantRows })),
          };
        }),
      })),
      insert: vi.fn((table: unknown) => {
        if (table === schema.MemoryMutation) {
          return { values: mocks.insertMutationValues };
        }
        if (table === schema.WikiNodeSource) {
          return { values: mocks.insertSourceValues };
        }
        if (table === schema.WikiNodeTag) {
          return { values: mocks.insertTagRows };
        }
        return { values: vi.fn() };
      }),
      update: vi.fn(() => ({ set: mocks.updateSet })),
      delete: vi.fn(() => ({ where: mocks.deleteWhere })),
      batch: mocks.batch,
    },
  };
});
vi.mock("../../s3", () => ({
  getObjectText: mocks.getObjectText,
  putObject: mocks.putObject,
  s3KeyFor: { wikiBody: (ws: string, v: string) => `wiki/${ws}/${v}.md` },
}));
vi.mock("../../index-node-version", () => ({
  indexNodeVersion: mocks.indexNodeVersion,
}));
vi.mock("@acme/db/node-metadata", () => ({
  loadNodeSources: mocks.loadNodeSources,
}));
vi.mock("../git-dispatch", () => ({
  notifyMemoryGitProjection: mocks.notifyMemoryGitProjection,
}));

const NO_FENCE: PathScope = { prefix: "", exclude: [] };

function makeFs(fence: PathScope = NO_FENCE) {
  return new GardenerFs("ws_1", "src_1", "job_1", [fence]);
}

const NODES = [
  {
    id: "n1",
    path: "projects/nimbase",
    kind: "note",
    title: "Nimbase",
    pinned: false,
    currentVersionId: "v1",
    summary: "Nimbase overview",
    s3Key: "wiki/ws_1/v1.md",
  },
  {
    id: "n2",
    path: "projects/nimbase/compile",
    kind: "note",
    title: "Compile Pipeline",
    pinned: true,
    currentVersionId: "v2",
    summary: "Compile pipeline",
    s3Key: "wiki/ws_1/v2.md",
  },
];

const TITLED_BODY = "---\ntitle: New Note\n---\n\n# New\n";

beforeEach(() => {
  mocks.selectRows.mockResolvedValue(NODES);
  mocks.selectGrantRows.mockResolvedValue([]); // no grants by default
  mocks.selectSourceRows.mockResolvedValue([]);
  mocks.getObjectText.mockResolvedValue("# Note\nhello gardener\n");
  mocks.updateSet.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  mocks.insertMutationValues.mockResolvedValue(undefined);
  mocks.batch.mockResolvedValue([]);
  mocks.insertTagRows.mockResolvedValue(undefined);
  mocks.insertSourceValues.mockReturnValue({
    onConflictDoNothing: mocks.insertSourceOnConflict,
  });
  mocks.insertSourceOnConflict.mockResolvedValue(undefined);
  mocks.deleteWhere.mockResolvedValue(undefined);
  mocks.loadNodeSources.mockResolvedValue([]);
  mocks.indexNodeVersion.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("tree", () => {
  it("lists paths sorted with summaries and pinned markers", async () => {
    const out = await makeFs().tree();
    expect(out).toBe(
      [
        "projects/nimbase — Nimbase overview",
        "projects/nimbase/compile [pinned] — Compile pipeline",
      ].join("\n"),
    );
  });

  it("reports an empty wiki", async () => {
    mocks.selectRows.mockResolvedValue([]);
    await expect(makeFs().tree()).resolves.toContain("empty wiki");
  });
});

describe("read", () => {
  it("returns the body and caches it", async () => {
    const fs = makeFs();
    await expect(fs.read("projects/nimbase")).resolves.toContain(
      "hello gardener",
    );
    await fs.read("projects/nimbase");
    expect(mocks.getObjectText).toHaveBeenCalledTimes(1);
  });

  it("throws VfsError for an unknown path", async () => {
    await expect(makeFs().read("nope")).rejects.toBeInstanceOf(VfsError);
  });
});

describe("grep", () => {
  it("returns path:line matches", async () => {
    const out = await makeFs().grep("gardener");
    expect(out).toContain("projects/nimbase:2: hello gardener");
  });

  it("reports no matches", async () => {
    await expect(makeFs().grep("zzz_absent")).resolves.toBe("no matches");
  });

  it("throws VfsError on an invalid regex", async () => {
    await expect(makeFs().grep("([")).rejects.toBeInstanceOf(VfsError);
  });
});

describe("write", () => {
  it("creates a node + version with a titled body, uploads, flips pointer, indexes", async () => {
    const out = await makeFs().write(
      "inbox/new-note.md",
      TITLED_BODY,
      "a new note",
    );
    expect(out).toBe('created "inbox/new-note.md"');
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    // The stored body is the OKF-serialized form: type + title + description
    // + server-stamped timestamp + this job's source URI, then the content.
    const [key, stored, contentType] = mocks.putObject.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(key).toMatch(/^wiki\/ws_1\/[0-9a-f-]+\.md$/);
    const versionId = key.slice("wiki/ws_1/".length, -".md".length);
    expect(contentType).toBe("text/markdown");
    expect(stored).toMatch(
      /^---\ntype: Note\ntitle: New Note\ndescription: a new note\ntimestamp: /,
    );
    expect(stored).toContain("nimbase://source/src_1");
    expect(stored).toContain("# New");
    expect(mocks.indexNodeVersion).toHaveBeenCalledWith({
      nodeVersionId: versionId,
      workspaceId: "ws_1",
      kind: "note",
      body: stored,
      summary: "a new note",
      jobId: "job_1",
    });
    expect(mocks.insertMutationValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        changes: [
          {
            type: "upsert",
            path: "inbox/new-note.md",
            versionId,
          },
        ],
        message: "Create inbox/new-note.md",
        sourceId: "src_1",
        jobId: "job_1",
      }),
    );
  });

  it("derives wiki_node.kind from the frontmatter type", async () => {
    await makeFs().write(
      "data/plans.md",
      "---\ntype: Dataset\ntitle: Plans\n---\n| a |\n|---|\n| 1 |\n",
      "plans table",
    );
    const setArg = mocks.updateSet.mock.calls[0]?.[0] as { kind?: string };
    expect(setArg.kind).toBe("dataset");
  });

  it("preserves unknown extension keys through the write", async () => {
    await makeFs().write(
      "inbox/new-note.md",
      "---\ntitle: X\nresource: https://r\n---\nv1\n",
      "s",
    );
    const stored = mocks.putObject.mock.calls[0]?.[1] as string;
    // js-yaml may quote values containing ":" — both forms are fine.
    expect(stored).toMatch(/resource: '?https:\/\/r'?/);
  });

  it("carries the frontmatter title into the WikiNode update", async () => {
    await makeFs().write("inbox/new-note.md", TITLED_BODY, "s");
    const setArg = mocks.updateSet.mock.calls[0]?.[0] as {
      title?: string;
    };
    expect(setArg.title).toBe("New Note");
  });

  it("updates an existing node without inserting a new one", async () => {
    const out = await makeFs().write(
      "projects/nimbase",
      "# V2\nhello\n",
      "updated",
    );
    expect(out).toBe('updated "projects/nimbase"');
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("refuses to write a pinned note", async () => {
    await expect(
      makeFs().write("projects/nimbase/compile", "x", "y"),
    ).rejects.toBeInstanceOf(VfsError);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("swallows indexing failures (best-effort, same as old compile)", async () => {
    mocks.indexNodeVersion.mockRejectedValue(new Error("embed down"));
    await expect(
      makeFs().write("inbox/new-note.md", TITLED_BODY, "s"),
    ).resolves.toContain("created");
  });

  it("rejects a new note whose body has no title in frontmatter", async () => {
    await expect(
      makeFs().write("inbox/new-note.md", "# New\n", "s"),
    ).rejects.toBeInstanceOf(VfsError);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("rejects a new note path that isn't kebab-case", async () => {
    await expect(
      makeFs().write("inbox/New Note.md", TITLED_BODY, "s"),
    ).rejects.toBeInstanceOf(VfsError);
  });

  it("rejects a new note path missing the .md extension", async () => {
    await expect(
      makeFs().write("inbox/new-note", TITLED_BODY, "s"),
    ).rejects.toBeInstanceOf(VfsError);
  });

  it("does not require path/title validation when updating an existing note", async () => {
    // "projects/nimbase" has no .md extension but already exists — updates
    // to legacy paths must keep working.
    await expect(
      makeFs().write("projects/nimbase", "# updated body\n", "s"),
    ).resolves.toContain("updated");
  });

  it("accepts a root-level note with no folder prefix", async () => {
    await expect(
      makeFs().write("root-note.md", TITLED_BODY, "s"),
    ).resolves.toBe('created "root-note.md"');
  });

  it("auto-unions this compile job's source into wiki_node_source", async () => {
    await makeFs().write("inbox/new-note.md", TITLED_BODY, "s");
    expect(mocks.insertSourceValues).toHaveBeenCalledOnce();
  });
});

describe("datasets are ordinary OKF writes", () => {
  it("has no writeDataset — the JSON path is gone", () => {
    const fs = makeFs();
    expect(
      (fs as unknown as Record<string, unknown>).writeDataset,
    ).toBeUndefined();
  });

  it("rejects .json leaves — every concept is markdown", async () => {
    await expect(
      makeFs().write("data/plans.json", "---\ntitle: X\n---\nx", "s"),
    ).rejects.toBeInstanceOf(VfsError);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});

describe("edit", () => {
  it("replaces unique text via a new version", async () => {
    const out = await makeFs().edit(
      "projects/nimbase",
      "hello gardener",
      "hello world",
    );
    expect(out).toBe('edited "projects/nimbase"');
    const stored = mocks.putObject.mock.calls[0]?.[1] as string;
    expect(stored).toContain("hello world");
    expect(stored).toMatch(/^---\ntype: Note\n/);
    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.any(String),
      stored,
      "text/markdown",
    );
  });

  it("rejects when oldText is missing or ambiguous", async () => {
    await expect(
      makeFs().edit("projects/nimbase", "absent", "x"),
    ).rejects.toBeInstanceOf(VfsError);
    mocks.getObjectText.mockResolvedValue("dup\ndup\n");
    await expect(
      makeFs().edit("projects/nimbase", "dup", "x"),
    ).rejects.toBeInstanceOf(VfsError);
  });

  it("keeps the node's existing title when the edited body has no frontmatter title", async () => {
    await makeFs().edit("projects/nimbase", "hello gardener", "hello world");
    const setArg = mocks.updateSet.mock.calls[0]?.[0] as {
      title?: string;
    };
    expect(setArg.title).toBe("Nimbase"); // falls back to NODES fixture's existing title
  });
});

describe("setTitle", () => {
  it("normalizes the title and folds it into the WikiNode update", async () => {
    await makeFs().setTitle("projects/nimbase", "  My   Title  ");
    const setArg = mocks.updateSet.mock.calls[0]?.[0] as {
      title?: string;
    };
    expect(setArg.title).toBe("My Title");
  });

  it("returns a confirmation message with the normalized title", async () => {
    const out = await makeFs().setTitle("projects/nimbase", "Custom Title");
    expect(out).toBe('titled "projects/nimbase": Custom Title');
  });

  it("rejects an empty title — every note requires a real one", async () => {
    await expect(
      makeFs().setTitle("projects/nimbase", "   "),
    ).rejects.toBeInstanceOf(VfsError);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("refuses to retitle a pinned note", async () => {
    await expect(
      makeFs().setTitle("projects/nimbase/compile", "x"),
    ).rejects.toBeInstanceOf(VfsError);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("throws for an unknown path", async () => {
    await expect(makeFs().setTitle("nope", "x")).rejects.toBeInstanceOf(
      VfsError,
    );
  });
});

describe("citeSources", () => {
  it("cites valid source ids and reports the count", async () => {
    mocks.selectSourceRows.mockResolvedValue([
      { id: "src_a" },
      { id: "src_b" },
    ]);
    const out = await makeFs().citeSources("projects/nimbase", [
      "src_a",
      "src_b",
    ]);
    expect(out).toBe('cited 2 source(s) on "projects/nimbase"');
    expect(mocks.insertSourceValues).toHaveBeenCalledWith([
      { workspaceId: "ws_1", nodeId: "n1", sourceId: "src_a" },
      { workspaceId: "ws_1", nodeId: "n1", sourceId: "src_b" },
      { workspaceId: "ws_1", nodeId: "n1", sourceId: "src_1" },
    ]);
    // Frontmatter-canonical: the cited URIs land in the stored body too.
    const stored = mocks.putObject.mock.calls[0]?.[1] as string;
    expect(stored).toContain("nimbase://source/src_a");
    expect(stored).toContain("nimbase://source/src_b");
    expect(mocks.insertSourceOnConflict).toHaveBeenCalled();
  });

  it("skips invalid source ids and reports how many were skipped", async () => {
    mocks.selectSourceRows.mockResolvedValue([{ id: "src_a" }]);
    const out = await makeFs().citeSources("projects/nimbase", [
      "src_a",
      "src_bogus",
    ]);
    expect(out).toBe(
      'cited 1 source(s) on "projects/nimbase" (1 invalid id(s) skipped)',
    );
  });

  it("dedups repeated source ids before inserting", async () => {
    mocks.selectSourceRows.mockResolvedValue([{ id: "src_a" }]);
    await makeFs().citeSources("projects/nimbase", ["src_a", "src_a"]);
    expect(mocks.insertSourceValues).toHaveBeenCalledWith([
      { workspaceId: "ws_1", nodeId: "n1", sourceId: "src_a" },
      { workspaceId: "ws_1", nodeId: "n1", sourceId: "src_1" },
    ]);
  });

  it("throws when none of the given ids exist in this workspace", async () => {
    mocks.selectSourceRows.mockResolvedValue([]);
    await expect(
      makeFs().citeSources("projects/nimbase", ["src_ghost"]),
    ).rejects.toBeInstanceOf(VfsError);
    expect(mocks.insertSourceValues).not.toHaveBeenCalled();
  });

  it("refuses to cite sources onto a pinned note", async () => {
    await expect(
      makeFs().citeSources("projects/nimbase/compile", ["src_a"]),
    ).rejects.toBeInstanceOf(VfsError);
    expect(mocks.selectSourceRows).not.toHaveBeenCalled();
  });

  it("throws for an unknown path", async () => {
    await expect(
      makeFs().citeSources("nope", ["src_a"]),
    ).rejects.toBeInstanceOf(VfsError);
  });
});

describe("listSources", () => {
  it("resolves the node by path and delegates to loadNodeSources", async () => {
    const refs = [
      {
        id: "src_a",
        kind: "web",
        title: "A",
        sourceUrl: null,
        capturedAt: null,
      },
    ];
    mocks.loadNodeSources.mockResolvedValue(refs);
    const out = await makeFs().listSources("projects/nimbase");
    expect(mocks.loadNodeSources).toHaveBeenCalledWith("n1");
    expect(out).toEqual(refs);
  });

  it("throws VfsError for an unknown path without calling loadNodeSources", async () => {
    await expect(makeFs().listSources("nope")).rejects.toBeInstanceOf(VfsError);
    expect(mocks.loadNodeSources).not.toHaveBeenCalled();
  });
});

describe("mv", () => {
  it("moves a subtree with a single UPDATE", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "n1",
        path: "a",
        kind: "folder",
        title: "A",
        pinned: false,
        currentVersionId: null,
        summary: null,
        s3Key: null,
      },
      {
        id: "n3",
        path: "a/b",
        kind: "note",
        title: "B",
        pinned: false,
        currentVersionId: "v3",
        summary: null,
        s3Key: "wiki/ws_1/v3.md",
      },
    ]);
    const out = await makeFs().mv("a", "c");
    expect(out).toContain("moved 2");
    expect(mocks.updateSet).toHaveBeenCalledTimes(1);
    expect(mocks.insertMutationValues).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ type: "move", from: "a", to: "c" }],
        message: "Move a to c",
      }),
    );
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("requires the .md leaf only when renaming a single note, not a subtree", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "n1",
        path: "a",
        kind: "folder",
        title: "A",
        pinned: false,
        currentVersionId: null,
        summary: null,
        s3Key: null,
      },
      {
        id: "n3",
        path: "a/b.md",
        kind: "note",
        title: "B",
        pinned: false,
        currentVersionId: "v3",
        summary: null,
        s3Key: "wiki/ws_1/v3.md",
      },
    ]);
    // "a" -> "c" is a folder-prefix rename (2 nodes in scope) — no .md
    // required on "c" even though children carry .md leaves of their own.
    await expect(makeFs().mv("a", "c")).resolves.toContain("moved 2");
  });

  it("requires a kebab-case + .md target when renaming a single note", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "n1",
        path: "inbox/note.md",
        kind: "note",
        title: "Note",
        pinned: false,
        currentVersionId: "v1",
        summary: null,
        s3Key: "wiki/ws_1/v1.md",
      },
    ]);
    await expect(
      makeFs().mv("inbox/note.md", "inbox/renamed"),
    ).rejects.toBeInstanceOf(VfsError); // missing .md
    await expect(
      makeFs().mv("inbox/note.md", "inbox/Renamed.md"),
    ).rejects.toBeInstanceOf(VfsError); // not kebab-case
    await expect(
      makeFs().mv("inbox/note.md", "inbox/renamed.md"),
    ).resolves.toContain("moved 1");
  });

  it("rejects a target with a non-kebab-case segment regardless of scope", async () => {
    await expect(
      makeFs().mv("projects/nimbase/compile", "Projects/nimbase/compile"),
    ).rejects.toBeInstanceOf(VfsError);
  });

  it("refuses when scope contains a pinned note or target exists", async () => {
    await expect(
      makeFs().mv("projects/nimbase", "projects/renamed"),
    ).rejects.toBeInstanceOf(VfsError); // pinned child in scope
    mocks.selectRows.mockResolvedValue([
      {
        id: "n1",
        path: "a",
        kind: "folder",
        title: "A",
        pinned: false,
        currentVersionId: null,
        summary: null,
        s3Key: null,
      },
      {
        id: "n2",
        path: "c",
        kind: "folder",
        title: "C",
        pinned: false,
        currentVersionId: null,
        summary: null,
        s3Key: null,
      },
    ]);
    await expect(makeFs().mv("a", "c")).rejects.toBeInstanceOf(VfsError); // target exists
  });
});

describe("rm", () => {
  it("refuses when the scope contains a pinned note", async () => {
    await expect(makeFs().rm("projects/nimbase")).rejects.toBeInstanceOf(
      VfsError,
    );
  });

  it("soft-deletes an unpinned scope", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "n1",
        path: "a",
        kind: "note",
        title: "A",
        pinned: false,
        restricted: false,
        currentVersionId: "v1",
        summary: null,
        s3Key: "wiki/ws_1/v1.md",
      },
    ]);
    const out = await makeFs().rm("a");
    expect(out).toContain("deleted 1");
    const setArg = mocks.updateSet.mock.calls[0]?.[0] as {
      deletedAt?: Date;
    };
    expect(setArg.deletedAt).toBeInstanceOf(Date);
    expect(mocks.insertMutationValues).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ type: "delete", path: "a" }],
        message: "Delete a",
      }),
    );
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("errors when nothing matches", async () => {
    await expect(makeFs().rm("missing")).rejects.toBeInstanceOf(VfsError);
  });
});

// ---------------------------------------------------------------------------
// Fence tests
// ---------------------------------------------------------------------------

const FENCE_NODES = [
  {
    id: "n_inbox",
    path: "inbox/a",
    kind: "note",
    title: "Inbox A",
    pinned: false,
    restricted: false,
    currentVersionId: "v_inbox",
    summary: "inbox note",
    s3Key: "wiki/ws_1/v_inbox.md",
  },
  {
    id: "n_sales",
    path: "sales/q3",
    kind: "note",
    title: "Q3",
    pinned: false,
    restricted: false,
    currentVersionId: "v_sales",
    summary: "q3 report",
    s3Key: "wiki/ws_1/v_sales.md",
  },
  {
    id: "n_lead",
    path: "leadership/comp",
    kind: "note",
    title: "Comp",
    pinned: false,
    restricted: false,
    currentVersionId: "v_lead",
    summary: "comp plan",
    s3Key: "wiki/ws_1/v_lead.md",
  },
];

describe("fence", () => {
  it("tree() omits paths outside the fence", async () => {
    mocks.selectRows.mockResolvedValue(FENCE_NODES);
    const fs = makeFs({ prefix: "", exclude: ["leadership"] });
    const out = await fs.tree();
    expect(out).toContain("sales/q3");
    expect(out).not.toContain("leadership/comp");
    expect(out).toContain("inbox/a");
  });

  it("write() outside the fence throws VfsError", async () => {
    mocks.selectRows.mockResolvedValue(FENCE_NODES);
    const fs = makeFs({ prefix: "sales", exclude: [] });
    await expect(
      fs.write("eng/api.md", TITLED_BODY, "eng note"),
    ).rejects.toBeInstanceOf(VfsError);
    await expect(
      fs.write("eng/api.md", TITLED_BODY, "eng note"),
    ).rejects.toThrow(/scope/i);
  });

  it("setTitle() outside the fence throws VfsError", async () => {
    mocks.selectRows.mockResolvedValue(FENCE_NODES);
    const fs = makeFs({ prefix: "sales", exclude: [] });
    await expect(fs.setTitle("eng/api", "x")).rejects.toBeInstanceOf(VfsError);
  });

  it("citeSources() outside the fence throws VfsError", async () => {
    mocks.selectRows.mockResolvedValue(FENCE_NODES);
    const fs = makeFs({ prefix: "sales", exclude: [] });
    await expect(fs.citeSources("eng/api", ["src_a"])).rejects.toBeInstanceOf(
      VfsError,
    );
  });

  it("listSources() outside the fence throws VfsError", async () => {
    mocks.selectRows.mockResolvedValue(FENCE_NODES);
    const fs = makeFs({ prefix: "sales", exclude: [] });
    await expect(fs.listSources("eng/api")).rejects.toBeInstanceOf(VfsError);
    expect(mocks.loadNodeSources).not.toHaveBeenCalled();
  });

  it("mv() across the boundary throws VfsError both directions", async () => {
    // sales→eng: from is in fence, to is outside
    mocks.selectRows.mockResolvedValue([
      {
        id: "n_sales",
        path: "sales/q3",
        kind: "note",
        title: "Q3",
        pinned: false,
        restricted: false,
        currentVersionId: "v_sales",
        summary: null,
        s3Key: "wiki/ws_1/v_sales.md",
      },
      {
        id: "n_eng",
        path: "eng/api",
        kind: "note",
        title: "API",
        pinned: false,
        restricted: false,
        currentVersionId: "v_eng",
        summary: null,
        s3Key: "wiki/ws_1/v_eng.md",
      },
    ]);
    mocks.selectGrantRows.mockResolvedValue([]);
    const fs = makeFs({ prefix: "sales", exclude: [] });

    await expect(fs.mv("sales/q3", "eng/q3")).rejects.toBeInstanceOf(VfsError);
    await expect(fs.mv("eng/x", "sales/x")).rejects.toBeInstanceOf(VfsError);
  });

  it("rm() of a subtree containing a grant-anchored folder throws VfsError", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "n_sales",
        path: "sales",
        kind: "folder",
        title: "Sales",
        pinned: false,
        restricted: false,
        currentVersionId: null,
        summary: null,
        s3Key: null,
      },
      {
        id: "n_sales_q3",
        path: "sales/q3",
        kind: "note",
        title: "Q3",
        pinned: false,
        restricted: false,
        currentVersionId: "v1",
        summary: "q3",
        s3Key: "wiki/ws_1/v1.md",
      },
    ]);
    // Simulate an AccessGrant row anchored to n_sales
    mocks.selectGrantRows.mockResolvedValue([{ folderId: "n_sales" }]);
    const fs = makeFs({ prefix: "", exclude: [] });

    await expect(fs.rm("sales")).rejects.toBeInstanceOf(VfsError);
    await expect(fs.rm("sales")).rejects.toThrow(/access grant/i);
  });

  it("rm() of a subtree containing a restricted folder throws VfsError", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "n_sales",
        path: "sales",
        kind: "folder",
        title: "Sales",
        pinned: false,
        restricted: false,
        currentVersionId: null,
        summary: null,
        s3Key: null,
      },
      {
        id: "n_restricted",
        path: "sales/secret",
        kind: "note",
        title: "Secret",
        pinned: false,
        restricted: true, // <-- restricted boundary
        currentVersionId: "v2",
        summary: "secret",
        s3Key: "wiki/ws_1/v2.md",
      },
    ]);
    mocks.selectGrantRows.mockResolvedValue([]);
    const fs = makeFs({ prefix: "", exclude: [] });

    await expect(fs.rm("sales")).rejects.toBeInstanceOf(VfsError);
    await expect(fs.rm("sales")).rejects.toThrow(/restricted folder/i);
  });
});

// ---------------------------------------------------------------------------
// Recorded ops (feed the provider's reconcile action derivation)
// ---------------------------------------------------------------------------

describe("recorded ops", () => {
  it("records a create for a new note write", async () => {
    const fs = makeFs();
    await fs.write("inbox/new-note.md", TITLED_BODY, "s");
    const [op] = fs.ops();
    expect(op).toMatchObject({
      op: "create",
      kind: "note",
      path: "inbox/new-note.md",
    });
    if (!op || op.op === "delete") throw new Error("expected write op");
    expect(typeof op.nodeId).toBe("string");
  });

  it("records an update when writing over an existing note", async () => {
    const fs = makeFs();
    await fs.write("projects/nimbase", "# V2\n", "s");
    expect(fs.ops()).toEqual([
      { op: "update", kind: "note", path: "projects/nimbase", nodeId: "n1" },
    ]);
  });

  it("records a create with dataset kind for a type: Dataset write", async () => {
    const fs = makeFs();
    await fs.write(
      "health/steps.md",
      "---\ntype: Dataset\ntitle: Steps\n---\n| date | steps |\n|---|---|\n| 2026-06-01 | 9000 |\n",
      "daily steps",
    );
    const [op] = fs.ops();
    expect(op).toMatchObject({
      op: "create",
      kind: "dataset",
      path: "health/steps.md",
    });
    if (!op || op.op === "delete") throw new Error("expected write op");
    expect(typeof op.nodeId).toBe("string");
  });

  it("records an update for edit", async () => {
    const fs = makeFs();
    await fs.edit("projects/nimbase", "hello gardener", "hello world");
    expect(fs.ops()).toEqual([
      { op: "update", kind: "note", path: "projects/nimbase", nodeId: "n1" },
    ]);
  });

  it("records a delete with the removed node ids for rm", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "n_a",
        path: "a",
        kind: "note",
        title: "A",
        pinned: false,
        restricted: false,
        currentVersionId: "v1",
        summary: null,
        s3Key: "wiki/ws_1/v1.md",
      },
    ]);
    const fs = makeFs();
    await fs.rm("a");
    expect(fs.ops()).toEqual([{ op: "delete", path: "a", nodeIds: ["n_a"] }]);
  });

  it("does not record metadata-only ops (setTitle)", async () => {
    const fs = makeFs();
    await fs.setTitle("projects/nimbase", "New Title");
    expect(fs.ops()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// forScopes: direct-write door (upsert) fenced to a scope list, no source
// ---------------------------------------------------------------------------

describe("GardenerFs.forScopes", () => {
  it("fences writes to the given scope list", async () => {
    mocks.selectRows.mockResolvedValue(FENCE_NODES);
    const fs = GardenerFs.forScopes("ws_1", null, null, [
      { prefix: "sales", exclude: [] },
    ]);
    await expect(
      fs.write("eng/api.md", TITLED_BODY, "s"),
    ).rejects.toBeInstanceOf(VfsError);
  });

  it("treats null scopes as unrestricted", async () => {
    const fs = GardenerFs.forScopes("ws_1", null, null, null);
    await expect(fs.write("eng/api.md", TITLED_BODY, "s")).resolves.toContain(
      "created",
    );
  });

  it("writes with no sourceId → skips the auto-cite into wiki_node_source", async () => {
    const fs = GardenerFs.forScopes("ws_1", null, null, null);
    await fs.write("eng/api.md", TITLED_BODY, "s");
    // The version write path unions the job's source onto the node; with no
    // source there is nothing to cite.
    expect(mocks.insertSourceValues).not.toHaveBeenCalled();
  });
});
