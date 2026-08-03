import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AcmeCloud from "@acme/cloud";
import type { ExtractJobData as ExtractJob } from "@acme/cloud";
import type * as Gardener from "@acme/cloud/memory/wiki";

// End-to-end capture pipeline test: calls the REAL ingestSource /
// presignBinarySource / finalizeBinarySource / processExtractJob /
// processCompileJob in sequence — only the true external boundaries (DB, S3,
// AI calls, Clerk, entitlements, the gardener) are faked. dispatchCompile /
// dispatchExtract are rewired to call the real job processors directly
// instead of going through QStash, so one call to the public entry point
// (ingestSource, or presign+finalize) cascades through the whole pipeline the
// same way it does in dev (QSTASH_TOKEN unset -> inline dispatch).
//
// This exists alongside the per-module unit tests (ingest-source.test.ts,
// ingest-binary.test.ts, extract.test.ts, process.test.ts) to catch wiring
// mismatches between stages that isolated mocking can hide — e.g. a field
// extract.ts expects that ingest-binary.ts never set on the row.

const mocks = vi.hoisted(() => {
  // Each table is a Proxy whose property access yields a column marker, so the
  // mocked eq()/isNull() below can record *which* column a condition targets.
  // Without this, `where` carries no information and an update patches every
  // row in the table — which silently breaks any test involving more than one
  // row of a kind (an archive and its children, say).
  const makeTable = (name: string) =>
    new Proxy(
      { name },
      {
        // Only string properties become column markers. Symbols (toPrimitive,
        // util.inspect.custom, ...) must fall through, or stringifying or
        // logging a table yields a marker object instead of the table.
        get: (target, prop) =>
          typeof prop === "string" && prop !== "name"
            ? { __col: prop }
            : (target as Record<string | symbol, unknown>)[prop],
      },
    ) as Record<string, unknown>;

  const SourceTable = makeTable("source");
  const CompileJobTable = makeTable("compile_job");
  const SpendLedgerTable = makeTable("spend_ledger");
  const WikiNodeTable = makeTable("wiki_node");
  const tables = new Map<unknown, Record<string, unknown>[]>([
    [SourceTable, []],
    [CompileJobTable, []],
    [SpendLedgerTable, []],
    [WikiNodeTable, []],
  ]);
  const s3Store = new Map<string, string | Uint8Array>();

  return {
    SourceTable,
    CompileJobTable,
    SpendLedgerTable,
    WikiNodeTable,
    tables,
    s3Store,
    assertWithinLimit: vi.fn(),
    getUser: vi.fn(),
    resolveModels: vi.fn(),
    costFor: vi.fn(),
    extractBinaryText: vi.fn(),
    parseBytes: vi.fn(),
    isParseableMime: vi.fn(() => false),
    parseConfigured: vi.fn(() => false),
    runGardener: vi.fn(),
  };
});

function findRow(
  table: unknown,
  id: string,
): Record<string, unknown> | undefined {
  return (mocks.tables.get(table) ?? []).find((row) => row.id === id);
}

interface ColRef {
  __col: string;
}
function colNameOf(value: unknown): string | null {
  return typeof value === "object" && value !== null && "__col" in value
    ? (value as ColRef).__col
    : null;
}

/** Evaluates a mocked eq/and/isNull condition tree against one row. */
function matchesCondition(
  row: Record<string, unknown>,
  cond: unknown,
): boolean {
  if (!cond || typeof cond !== "object") return true;
  if ("__and" in cond) {
    return (cond as { __and: unknown[] }).__and.every((c) =>
      matchesCondition(row, c),
    );
  }
  if ("__eq" in cond) {
    const { __eq, value } = cond as { __eq: unknown; value: unknown };
    const col = colNameOf(__eq);
    return col === null ? true : row[col] === value;
  }
  if ("__isNull" in cond) {
    const col = colNameOf((cond as { __isNull: unknown }).__isNull);
    return col === null ? true : row[col] == null;
  }
  return true;
}

// Conditions are structural so `where` can evaluate them against a row. An
// unrecognised condition matches everything, keeping this permissive for the
// query shapes it doesn't model.
vi.mock("@acme/db", () => ({
  and: vi.fn((...conds: unknown[]) => ({ __and: conds })),
  eq: vi.fn((col: unknown, value: unknown) => ({ __eq: col, value })),
  isNull: vi.fn((col: unknown) => ({ __isNull: col })),
}));
vi.mock("@acme/db/schema", () => ({
  Source: mocks.SourceTable,
  CompileJob: mocks.CompileJobTable,
  ProviderAccessPolicy: {},
  SpendLedger: mocks.SpendLedgerTable,
  WikiNode: mocks.WikiNodeTable,
}));
vi.mock("@acme/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = (mocks.tables.get(table) ?? []).filter((row) =>
            matchesCondition(row, cond),
          );
          const chain = {
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
            then: (
              resolve: (v: unknown) => unknown,
              reject: (e: unknown) => unknown,
            ) => Promise.resolve(rows).then(resolve, reject),
          };
          return chain;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        const stored = { id: crypto.randomUUID(), ...row };
        mocks.tables.set(table, [...(mocks.tables.get(table) ?? []), stored]);
        return Object.assign(Promise.resolve(stored), {
          returning: () => Promise.resolve([{ id: stored.id }]),
        });
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const rows = (mocks.tables.get(table) ?? []).map((row) =>
            matchesCondition(row, cond) ? { ...row, ...patch } : row,
          );
          mocks.tables.set(table, rows);
          return Promise.resolve(undefined);
        },
      }),
    }),
  },
}));

// Real s3KeyFor and buildRawMd (pure, no side effects); only the I/O methods
// are faked, backed by the shared in-memory s3Store.
vi.mock("@acme/cloud", async (importOriginal) => {
  const actual = await importOriginal<typeof AcmeCloud>();
  return {
    ...actual,
    s3: {
      ...actual.s3,
      putObject: (key: string, body: string) => {
        mocks.s3Store.set(key, body);
        return Promise.resolve();
      },
      getObjectText: (key: string) =>
        Promise.resolve(String(mocks.s3Store.get(key) ?? "")),
      getObjectBytes: (key: string) => {
        const value = mocks.s3Store.get(key);
        return Promise.resolve(
          value instanceof Uint8Array
            ? value
            : new TextEncoder().encode(String(value ?? "")),
        );
      },
      presignPutUrl: (key: string) =>
        Promise.resolve(`https://fake-s3.test/${key}`),
      headObject: (key: string) => Promise.resolve(mocks.s3Store.has(key)),
    },
    resolveModels: mocks.resolveModels,
    costFor: mocks.costFor,
    extractBinaryText: mocks.extractBinaryText,
    parseBytes: mocks.parseBytes,
    isParseableMime: mocks.isParseableMime,
    parseConfigured: mocks.parseConfigured,
  };
});
vi.mock("@acme/api/entitlements", () => ({
  assertWithinLimit: mocks.assertWithinLimit,
  EntitlementError: class EntitlementError extends Error {},
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ users: { getUser: mocks.getUser } }),
}));
vi.mock("@acme/cloud/memory/wiki", async (importOriginal) => {
  const actual = await importOriginal<typeof Gardener>();
  return { ...actual, runGardener: mocks.runGardener };
});
// Bypass QStash entirely: a "dispatch" just runs the real job processor
// inline, the same way dev does when QSTASH_TOKEN is unset.
vi.mock("~/server/compile/dispatch", async () => {
  const { processCompileJob } = await import("../compile/process");
  return { dispatchCompile: processCompileJob };
});
// Mirrors the real runExtractJob tail inline: run the job, then dispatch the
// extract jobs for any children an archive expanded into. Inlined rather than
// imported because this factory *is* the ./extract-dispatch module.
vi.mock("./extract-dispatch", async () => {
  const { processExtractJob } = await import("./extract");
  const dispatchExtract = async (data: ExtractJob): Promise<void> => {
    for (const child of await processExtractJob(data)) {
      await dispatchExtract(child);
    }
  };
  return { dispatchExtract };
});
const { ingestSource } = await import("./ingest-source");
const { presignBinarySource, finalizeBinarySource } = await import(
  "./ingest-binary"
);
const { processExtractJob } = await import("./extract");

const CTX = { workspaceId: "ws_1", userId: "user_1", targetFolderId: null };

beforeEach(() => {
  for (const table of mocks.tables.keys()) mocks.tables.set(table, []);
  mocks.s3Store.clear();

  mocks.assertWithinLimit.mockResolvedValue(undefined);
  mocks.getUser.mockResolvedValue({ fullName: "Ada Lovelace" });
  mocks.resolveModels.mockResolvedValue({
    chat: {
      id: "anthropic/claude-sonnet-4.6",
      model: "anthropic/claude-sonnet-4.6",
    },
  });
  mocks.costFor.mockReturnValue(10);
  mocks.extractBinaryText.mockResolvedValue({
    markdown: "OCR text",
    modelId: "google/gemini-2.5-flash",
    usage: { inputTokens: 500, outputTokens: 50 },
  });
  mocks.runGardener.mockResolvedValue({
    report: "merged into projects/nimbase",
    usage: { inputTokens: 100, outputTokens: 10 },
    ops: [],
  });
});

afterEach(() => vi.clearAllMocks());

describe("capture flow: web text capture", () => {
  it("carries a web capture through ingest straight to compiled", async () => {
    const result = await ingestSource(
      {
        kind: "web",
        text: "# Hello\n\nWorld",
        sourceUrl: "https://example.com/a",
        title: "Hello",
      },
      CTX,
    );

    const source = findRow(mocks.SourceTable, result.sourceId);
    expect(source?.status).toBe("compiled");
    expect(source?.compileReport).toBe("merged into projects/nimbase");

    const originalKey = source?.s3KeyOriginal as string;
    const rawMdKey = source?.s3KeyRawMd as string;
    // The original is byte-exact — no Nimbase templating.
    expect(mocks.s3Store.get(originalKey)).toBe("# Hello\n\nWorld");
    const rawMd = String(mocks.s3Store.get(rawMdKey));
    expect(rawMd).toContain('title: "Hello"');
    expect(rawMd).toContain("# Hello\n\nWorld");

    // Compile reads exactly what ingest wrote as raw.md.
    expect(mocks.runGardener).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: rawMd, sourceKind: "web" }),
    );

    const spend = mocks.tables.get(mocks.SpendLedgerTable) ?? [];
    expect(spend.some((s) => s.kind === "compile")).toBe(true);
    expect(spend.some((s) => s.kind === "extract")).toBe(false);
  });
});

describe("capture flow: screenshot binary capture", () => {
  it("carries a screenshot through presign -> upload -> extract -> compile", async () => {
    const presign = await presignBinarySource(
      {
        kind: "screenshot",
        mimeType: "image/png",
        sizeBytes: 4,
        title: "Shot",
      },
      CTX,
    );

    const uploading = findRow(mocks.SourceTable, presign.sourceId);
    expect(uploading?.status).toBe("uploading");
    const originalKey = uploading?.s3KeyOriginal as string;

    // Simulate the client's presigned PUT landing before finalize is called.
    mocks.s3Store.set(originalKey, new Uint8Array([1, 2, 3, 4]));

    const finalize = await finalizeBinarySource(presign.sourceId, CTX);
    expect(finalize.status).toBe("extracting");

    const final = findRow(mocks.SourceTable, presign.sourceId);
    expect(final?.status).toBe("compiled");
    // The original is untouched throughout.
    expect(mocks.s3Store.get(originalKey)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    const rawMdKey = final?.s3KeyRawMd as string;
    const rawMd = String(mocks.s3Store.get(rawMdKey));
    expect(rawMd).toContain("OCR text");
    expect(mocks.extractBinaryText).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "screenshot", mimeType: "image/png" }),
    );
    expect(mocks.runGardener).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: rawMd, sourceKind: "screenshot" }),
    );

    const spend = mocks.tables.get(mocks.SpendLedgerTable) ?? [];
    expect(spend.some((s) => s.kind === "extract")).toBe(true);
    expect(spend.some((s) => s.kind === "compile")).toBe(true);
  });
});

describe("capture flow: text-native file capture", () => {
  it("carries a .txt file through with no AI extraction call", async () => {
    const presign = await presignBinarySource(
      {
        kind: "file",
        mimeType: "text/plain",
        sizeBytes: 16,
        originalFilename: "notes.txt",
      },
      CTX,
    );
    const uploading = findRow(mocks.SourceTable, presign.sourceId);
    const originalKey = uploading?.s3KeyOriginal as string;
    expect(originalKey).toMatch(/\.txt$/);
    mocks.s3Store.set(originalKey, new TextEncoder().encode("hello from disk"));

    await finalizeBinarySource(presign.sourceId, CTX);

    expect(mocks.extractBinaryText).not.toHaveBeenCalled();
    const final = findRow(mocks.SourceTable, presign.sourceId);
    expect(final?.status).toBe("compiled");
    const rawMd = String(mocks.s3Store.get(final?.s3KeyRawMd as string));
    expect(rawMd).toContain("hello from disk");
    expect(rawMd).toContain('originalFilename: "notes.txt"');

    const spend = mocks.tables.get(mocks.SpendLedgerTable) ?? [];
    expect(spend.some((s) => s.kind === "extract")).toBe(false);
  });
});

describe("capture flow: zip archive import", () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);

  async function uploadZip(files: Record<string, Uint8Array>) {
    const archive = zipSync(files);
    const presign = await presignBinarySource(
      {
        kind: "file",
        mimeType: "application/zip",
        sizeBytes: archive.length,
        originalFilename: "wiki-export.zip",
        title: "Wiki export",
      },
      CTX,
    );
    const container = findRow(mocks.SourceTable, presign.sourceId);
    mocks.s3Store.set(container?.s3KeyOriginal as string, archive);
    await finalizeBinarySource(presign.sourceId, CTX);
    return presign.sourceId;
  }

  it("fans one archive out into a compiled source per entry", async () => {
    const containerId = await uploadZip({
      "handbook.md": utf8("# Handbook\n\nHow we work."),
      "docs/pricing.csv": utf8("plan,price\npro,20"),
      "__MACOSX/._handbook.md": utf8("junk"),
    });

    const sources = mocks.tables.get(mocks.SourceTable) ?? [];
    // The container plus one child per real entry — the junk path is dropped.
    expect(sources).toHaveLength(3);

    const children = sources.filter((s) => s.id !== containerId);
    expect(children.map((c) => c.title).sort()).toEqual([
      "docs/pricing.csv",
      "handbook.md",
    ]);
    expect(children.map((c) => c.mimeType).sort()).toEqual([
      "text/csv",
      "text/markdown",
    ]);
    // Children carry provenance back to the archive they came from.
    for (const child of children) {
      const metadata = child.metadata as { archiveSourceId: string };
      expect(metadata.archiveSourceId).toBe(containerId);
    }

    // Each child compiled from its own decoded bytes; the container did not.
    expect(mocks.runGardener).toHaveBeenCalledTimes(2);
    const compiled = mocks.runGardener.mock.calls
      .map((call) => String((call[0] as { rawText: string }).rawText))
      .join("\n");
    expect(compiled).toContain("How we work.");
    expect(compiled).toContain("plan,price");
    expect(compiled).not.toContain("Expanded into");
  });

  it("stores a manifest for the container and never compiles it", async () => {
    const containerId = await uploadZip({ "notes.md": utf8("just one") });

    const container = findRow(mocks.SourceTable, containerId);
    const manifest = String(mocks.s3Store.get(container?.s3KeyRawMd as string));
    expect(manifest).toContain("Expanded into 1 source.");

    // One CompileJob total — the child's. Compiling the archive itself would
    // write a "contents of wiki-export.zip" note into memory.
    const compileJobs = mocks.tables.get(mocks.CompileJobTable) ?? [];
    expect(compileJobs).toHaveLength(1);
    expect(compileJobs[0]?.sourceId).not.toBe(containerId);
  });

  it("does not re-expand on a simulated QStash retry", async () => {
    const containerId = await uploadZip({
      "a.md": utf8("a"),
      "b.md": utf8("b"),
    });
    expect(mocks.tables.get(mocks.SourceTable)).toHaveLength(3);

    await processExtractJob({
      jobId: "retry_1",
      workspaceId: "ws_1",
      sourceId: containerId,
    });

    // Still 3 rows: the retry saw status !== "extracting" and returned.
    expect(mocks.tables.get(mocks.SourceTable)).toHaveLength(3);
    expect(mocks.runGardener).toHaveBeenCalledTimes(2);
  });
});

describe("capture flow: extract-job idempotency", () => {
  it("does not double-extract or double-bill on a simulated QStash retry", async () => {
    const presign = await presignBinarySource(
      { kind: "voice", mimeType: "audio/webm", sizeBytes: 4 },
      CTX,
    );
    const uploading = findRow(mocks.SourceTable, presign.sourceId);
    mocks.s3Store.set(uploading?.s3KeyOriginal as string, new Uint8Array([9]));
    await finalizeBinarySource(presign.sourceId, CTX);

    expect(mocks.extractBinaryText).toHaveBeenCalledTimes(1);
    const compileJobsAfterFirst = mocks.tables.get(mocks.CompileJobTable) ?? [];
    expect(compileJobsAfterFirst).toHaveLength(1);

    // A QStash retry re-delivers the same extract job after it already
    // completed (source status has moved past "extracting").
    await processExtractJob({
      jobId: "retry",
      workspaceId: "ws_1",
      sourceId: presign.sourceId,
    });

    expect(mocks.extractBinaryText).toHaveBeenCalledTimes(1);
    const spend = mocks.tables.get(mocks.SpendLedgerTable) ?? [];
    expect(spend.filter((s) => s.kind === "extract")).toHaveLength(1);
    const compileJobsAfterRetry = mocks.tables.get(mocks.CompileJobTable) ?? [];
    expect(compileJobsAfterRetry).toHaveLength(1);
  });
});
