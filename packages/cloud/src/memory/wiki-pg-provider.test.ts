// wiki-pg-provider.test.ts — read-side MemoryProvider behavior without a live
// DB. @acme/db/client is mocked to prevent the POSTGRES_URL env throw at import
// time; every assertion here runs before any DB access (toolset gate, capability
// gate) or exercises a pure helper.

import { describe, expect, it, vi } from "vitest";

import type { PathScope } from "@acme/db";
import type { NodeSourceRef } from "@acme/db/node-metadata";
import type { GrantRole } from "@acme/db/schema";
import { PgDialect, sql } from "@acme/db";

import type { SourceRef } from "./node";
import { ToolsetForbiddenError, toProviderContext } from "./context";
import { CapabilityNotSupportedError } from "./provider";
import {
  assembleMemoryNode,
  deriveReconcileAction,
  scopeWhere,
  toSourceRefs,
  WikiPgProvider,
} from "./wiki-pg-provider";

// Prevent @acme/db/client (and the node-metadata module it backs) from throwing
// "Missing POSTGRES_URL" when the provider module graph loads.
vi.mock("@acme/db/client", () => ({ db: {} }));

const ROOT: PathScope[] = [{ prefix: "", exclude: [] }];

// Build a branded ProviderAccessContext via the only constructor. Defaults to a
// reader at root; pass `read: []` to withhold the read toolset.
function makeCtx(
  opts: {
    read?: PathScope[] | null;
    capture?: PathScope[] | null;
    admin?: PathScope[] | null;
  } = {},
) {
  const byRole: Record<GrantRole, PathScope[] | null> = {
    viewer: opts.read === undefined ? ROOT : opts.read,
    contributor: opts.capture ?? [],
    manager: opts.admin ?? [],
  };
  return toProviderContext({
    workspaceId: "ws1",
    userId: "user1",
    scopes: (minRole: GrantRole) => byRole[minRole],
  });
}

const dialect = new PgDialect();

describe("WikiPgProvider.capabilities", () => {
  const provider = new WikiPgProvider();

  it("advertises the read-side ops", () => {
    expect(provider.capabilities.has("search")).toBe(true);
    expect(provider.capabilities.has("fetch")).toBe(true);
    expect(provider.capabilities.has("neighbors")).toBe(true);
    expect(provider.capabilities.has("provenance")).toBe(true);
  });

  it("advertises the write ops (upsert + reconcile); link stays off", () => {
    expect(provider.capabilities.has("upsert")).toBe(true);
    expect(provider.capabilities.has("reconcile")).toBe(true);
    // No edge table yet.
    expect(provider.capabilities.has("link")).toBe(false);
  });
});

describe("WikiPgProvider read-op toolset gate", () => {
  const provider = new WikiPgProvider();
  // Read withheld: viewer scopes are empty ([] = no access).
  const noRead = makeCtx({ read: [] });

  it("search rejects a context lacking the read toolset", async () => {
    await expect(provider.search(noRead, { text: "hi" })).rejects.toThrow(
      ToolsetForbiddenError,
    );
  });

  it("fetch rejects a context lacking the read toolset", async () => {
    await expect(provider.fetch(noRead, "n1")).rejects.toThrow(
      ToolsetForbiddenError,
    );
  });

  it("neighbors rejects a context lacking the read toolset", async () => {
    await expect(provider.neighbors(noRead, "n1")).rejects.toThrow(
      ToolsetForbiddenError,
    );
  });

  it("provenance rejects a context lacking the read toolset", async () => {
    await expect(provider.provenance(noRead, "n1")).rejects.toThrow(
      ToolsetForbiddenError,
    );
  });
});

describe("WikiPgProvider write-op toolset gate (capture)", () => {
  const provider = new WikiPgProvider();
  // Reader only: capture toolset withheld (contributor scopes empty).
  const noCapture = makeCtx({ read: ROOT, capture: [] });

  const OPTS = {
    sourceId: "src1",
    jobId: "job1",
    fence: { prefix: "", exclude: [] },
  };

  it("upsert rejects a context lacking the capture toolset (before any write)", async () => {
    await expect(
      provider.upsert(noCapture, {
        kind: "note",
        title: "t",
        content: "c",
        path: "inbox/n.md",
      }),
    ).rejects.toThrow(ToolsetForbiddenError);
  });

  it("reconcile rejects a context lacking the capture toolset (before the gardener)", async () => {
    await expect(
      provider.reconcile(
        noCapture,
        { sourceKind: "web", title: "t", content: "c" },
        OPTS,
      ),
    ).rejects.toThrow(ToolsetForbiddenError);
  });
});

describe("WikiPgProvider unsupported ops", () => {
  const provider = new WikiPgProvider();
  const ctx = makeCtx();

  it("link throws CapabilityNotSupportedError (no edge table)", () => {
    expect(() =>
      provider.link(ctx, { fromId: "a", toId: "b", relation: "related" }),
    ).toThrow(CapabilityNotSupportedError);
  });
});

describe("deriveReconcileAction", () => {
  it("a lone new-note write → insert with its nodeId", () => {
    expect(
      deriveReconcileAction([
        { op: "create", kind: "note", path: "a.md", nodeId: "n1" },
      ]),
    ).toEqual({ action: "insert", nodeId: "n1" });
  });

  it("an in-place update → merge with its nodeId", () => {
    expect(
      deriveReconcileAction([
        { op: "update", kind: "note", path: "a.md", nodeId: "n1" },
      ]),
    ).toEqual({ action: "merge", nodeId: "n1" });
  });

  it("a delete alongside a write → supersede: survivor + retired ids", () => {
    expect(
      deriveReconcileAction([
        { op: "update", kind: "note", path: "keep.md", nodeId: "keep" },
        { op: "delete", path: "dup.md", nodeIds: ["dup1", "dup2"] },
      ]),
    ).toEqual({
      action: "supersede",
      nodeId: "keep",
      supersededIds: ["dup1", "dup2"],
    });
  });

  it("deletes with no surviving write → noop (housekeeping) reported in deletedIds", () => {
    expect(
      deriveReconcileAction([
        { op: "delete", path: "dup.md", nodeIds: ["dup1", "dup2"] },
      ]),
    ).toEqual({ action: "noop", deletedIds: ["dup1", "dup2"] });
  });

  it("create wins over update when both happen (most transformative)", () => {
    expect(
      deriveReconcileAction([
        { op: "update", kind: "note", path: "a.md", nodeId: "a" },
        { op: "create", kind: "note", path: "b.md", nodeId: "b" },
      ]),
    ).toEqual({ action: "insert", nodeId: "b" });
  });

  it("no mutations → noop", () => {
    expect(deriveReconcileAction([])).toEqual({ action: "noop" });
  });
});

describe("assembleMemoryNode", () => {
  const sources: SourceRef[] = [{ uri: "https://example.com/a" }];

  it("maps a wiki row + version + body onto the contract DTO", () => {
    const updatedAt = new Date("2026-07-03T12:00:00.000Z");
    const node = assembleMemoryNode({
      id: "node-1",
      path: "eng/design",
      title: "Design",
      body: "# Design\n\nbody text",
      tags: ["arch", "wip"],
      sources,
      summary: "short summary",
      updatedAt,
    });
    expect(node).toEqual({
      id: "node-1",
      kind: "note",
      title: "Design",
      content: "# Design\n\nbody text",
      metadata: { path: "eng/design" },
      labels: ["arch", "wip"],
      sources,
      summary: "short summary",
      updatedAt,
    });
  });

  it("omits summary/updatedAt as top-level fields when null/undefined, and defaults sources to []", () => {
    const withNull = assembleMemoryNode({
      id: "n",
      path: "p",
      title: "t",
      body: "b",
      tags: [],
      summary: null,
      updatedAt: null,
    });
    expect(withNull.metadata).toEqual({ path: "p" });
    expect("summary" in withNull).toBe(false);
    expect("updatedAt" in withNull).toBe(false);
    expect(withNull.sources).toEqual([]);

    const withUndefined = assembleMemoryNode({
      id: "n",
      path: "p",
      title: "t",
      body: "b",
      tags: [],
    });
    expect(withUndefined.metadata).toEqual({ path: "p" });
    expect("summary" in withUndefined).toBe(false);
    expect("updatedAt" in withUndefined).toBe(false);
  });

  it("sets summary and updatedAt as top-level fields when present", () => {
    const updatedAt = new Date("2026-01-02T03:04:05.000Z");
    const node = assembleMemoryNode({
      id: "n",
      path: "p",
      title: "t",
      body: "b",
      tags: [],
      summary: "s",
      updatedAt,
    });
    expect(node.summary).toBe("s");
    expect(node.updatedAt).toBe(updatedAt);
    // summary/updatedAt are contract fields, not metadata-bag entries.
    expect(node.metadata).toEqual({ path: "p" });
  });
});

describe("toSourceRefs", () => {
  it("uses the capture URL as the uri when present", () => {
    const rows: NodeSourceRef[] = [
      {
        id: "s1",
        kind: "web",
        title: "A page",
        sourceUrl: "https://example.com/page",
        capturedAt: null,
      },
    ];
    expect(toSourceRefs(rows)).toEqual([{ uri: "https://example.com/page" }]);
  });

  it("falls back to a stable internal id ref for URL-less captures", () => {
    const rows: NodeSourceRef[] = [
      {
        id: "s2",
        kind: "voice",
        title: null,
        sourceUrl: null,
        capturedAt: null,
      },
    ];
    expect(toSourceRefs(rows)).toEqual([{ uri: "nimbase:source/s2" }]);
  });
});

describe("scopeWhere (SQL-side scope filtering)", () => {
  it("null scopes (admin) → no filter (undefined)", () => {
    expect(scopeWhere(sql`n.path`, null)).toBeUndefined();
  });

  it("empty scopes → literal false", () => {
    const frag = scopeWhere(sql`n.path`, []);
    if (!frag) throw new Error("expected a SQL fragment for empty scopes");
    expect(dialect.sqlToQuery(frag).sql).toBe("false");
  });

  it("prefix scopes → LIKE match compiled from ctx scopes", () => {
    const frag = scopeWhere(sql`n.path`, [{ prefix: "eng", exclude: [] }]);
    if (!frag) throw new Error("expected a SQL fragment for prefix scopes");
    const q = dialect.sqlToQuery(frag);
    expect(q.sql).toContain("LIKE");
    expect(q.params).toContain("eng/%");
  });
});
