// access-sql.test.ts — pathScopeWhere SQL correctness tests.
// Uses real drizzle-orm to inspect generated SQL via PgDialect.
// @acme/db/client is mocked to prevent POSTGRES_URL env throw (pathScopeWhere
// is pure — it never touches the DB at all).

import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { describe, expect, it, vi } from "vitest";

import type { PathScope } from "./access-core";
import { pathScopeWhere } from "./access";

// Prevent @acme/db/client from throwing "Missing POSTGRES_URL" at import time.
vi.mock("@acme/db/client", () => ({ db: {} }));

const dialect = new PgDialect();
const pathCol = sql.raw("wiki_node.path");

// Throws on undefined so callers get a non-optional Query (tests that expect
// undefined call pathScopeWhere directly instead).
function toQuery(fragment: ReturnType<typeof pathScopeWhere>) {
  if (fragment === undefined) {
    throw new Error("expected an SQL fragment, got undefined");
  }
  return dialect.sqlToQuery(fragment);
}

describe("pathScopeWhere SQL generation", () => {
  it("null scopes (admin) → undefined (no WHERE clause added)", () => {
    expect(pathScopeWhere(pathCol, null)).toBeUndefined();
  });

  it("empty scopes → literal `false`", () => {
    const q = toQuery(pathScopeWhere(pathCol, []));
    expect(q.sql).toBe("false");
    expect(q.params).toHaveLength(0);
  });

  it("root prefix ('') → `true` (no LIKE needed)", () => {
    const scopes: PathScope[] = [{ prefix: "", exclude: [] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    expect(q.sql).toContain("true");
    expect(q.sql).not.toContain("LIKE");
    expect(q.params).toHaveLength(0);
  });

  it("non-root prefix: equality + LIKE with ESCAPE clause", () => {
    const scopes: PathScope[] = [{ prefix: "eng", exclude: [] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    expect(q.sql).toContain("LIKE");
    expect(q.sql).toContain("ESCAPE");
    expect(q.params).toContain("eng");
    expect(q.params).toContain("eng/%");
  });

  it("ESCAPE correctness: prefix 'a%' → LIKE param 'a\\%/%' (% neutralised)", () => {
    const scopes: PathScope[] = [{ prefix: "a%", exclude: [] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    // Equality uses raw prefix
    expect(q.params).toContain("a%");
    // LIKE param has % escaped — in JS string: "a\\%/%" (5 chars: a \ % / %)
    expect(q.params).toContain("a\\%/%");
    expect(q.sql).toContain("ESCAPE '\\'");
  });

  it("ESCAPE correctness: prefix 'a_b' → LIKE param 'a\\_b/%' (_ neutralised)", () => {
    const scopes: PathScope[] = [{ prefix: "a_b", exclude: [] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    expect(q.params).toContain("a_b");
    expect(q.params).toContain("a\\_b/%");
  });

  it("ESCAPE correctness: prefix 'a\\\\b' → LIKE param 'a\\\\\\\\b/%' (\\ escaped)", () => {
    // JS string "a\\b" is the 3-char sequence: a, \, b
    // escapeLikePrefix("a\\b") → "a\\\\b" (a, \, \, b) — the backslash is doubled
    // LIKE param: "a\\\\b/%" (JS string: a \ \ b / %)
    const scopes: PathScope[] = [{ prefix: "a\\b", exclude: [] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    expect(q.params).toContain("a\\b");
    expect(q.params).toContain("a\\\\b/%");
  });

  it("scope with exclude: wraps in AND NOT, exclude prefix is also LIKE-escaped", () => {
    const scopes: PathScope[] = [{ prefix: "eng", exclude: ["eng/secret"] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    expect(q.sql).toContain("AND");
    expect(q.sql).toContain("NOT");
    expect(q.params).toContain("eng/secret");
    expect(q.params).toContain("eng/secret/%");
  });

  it("scope with exclude using tricky name: 'eng/a%b' → exclude LIKE 'eng/a\\%b/%'", () => {
    const scopes: PathScope[] = [{ prefix: "eng", exclude: ["eng/a%b"] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    expect(q.params).toContain("eng/a%b");
    expect(q.params).toContain("eng/a\\%b/%");
  });

  it("multiple scopes produce OR-joined conditions", () => {
    const scopes: PathScope[] = [
      { prefix: "eng", exclude: [] },
      { prefix: "sales", exclude: [] },
    ];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    expect(q.sql).toContain("OR");
    expect(q.params).toContain("eng");
    expect(q.params).toContain("sales");
    expect(q.params).toContain("eng/%");
    expect(q.params).toContain("sales/%");
  });

  it("complex: mixed prefixes with wildcards and excludes", () => {
    const scopes: PathScope[] = [{ prefix: "a%b", exclude: ["a%b/c_d"] }];
    const q = toQuery(pathScopeWhere(pathCol, scopes));
    // Allow LIKE param
    expect(q.params).toContain("a\\%b/%");
    // Exclude LIKE param — both % and _ escaped
    expect(q.params).toContain("a\\%b/c\\_d/%");
  });
});
