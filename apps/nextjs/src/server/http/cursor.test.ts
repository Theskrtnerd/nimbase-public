import { describe, expect, it } from "vitest";

import { clampLimit, decodeCursor, encodeCursor } from "./cursor";

const ID = "7c3413c7-71b6-44a5-8448-e8cf871ee0d5";
// Postgres text form, microseconds included — what `created_at::text` returns.
const PG_TIMESTAMP = "2026-07-25 08:49:41.376593+00";

describe("keyset cursors", () => {
  it("round-trips a sort key", () => {
    expect(
      decodeCursor(encodeCursor({ createdAt: PG_TIMESTAMP, id: ID })),
    ).toEqual({ createdAt: PG_TIMESTAMP, id: ID });
  });

  /**
   * The bug this shape exists for: routing the timestamp through a JS Date
   * truncates Postgres's microseconds to milliseconds, so the boundary no longer
   * matches the row it came from and every row sharing that millisecond is
   * silently skipped on the next page.
   */
  it("preserves microsecond precision", () => {
    const cursor = encodeCursor({ createdAt: PG_TIMESTAMP, id: ID });
    expect(cursor).toContain(".376593");
    expect(decodeCursor(cursor)?.createdAt).toBe(PG_TIMESTAMP);
    // What a Date round-trip would have produced instead.
    expect(new Date(PG_TIMESTAMP).toISOString()).toBe(
      "2026-07-25T08:49:41.376Z",
    );
  });

  it("also accepts ISO form", () => {
    const iso = "2026-07-25T08:49:41.376Z";
    expect(decodeCursor(`${iso}|${ID}`)).toEqual({ createdAt: iso, id: ID });
  });

  /**
   * Every rejected case matters beyond tidiness: the decoded values are cast to
   * `::timestamptz` and `::uuid` in SQL, so an unvalidated cursor would make
   * Postgres raise and surface as a 500.
   */
  it.each([
    ["no separator", PG_TIMESTAMP],
    ["unparseable timestamp", `not-a-date|${ID}`],
    ["empty id", `${PG_TIMESTAMP}|`],
    ["non-uuid id", `${PG_TIMESTAMP}|abc`],
    ["sql injection attempt", `${PG_TIMESTAMP}|') or 1=1--`],
    ["empty string", ""],
    ["separator only", "|"],
  ])("returns undefined for %s", (_label, cursor) => {
    expect(decodeCursor(cursor)).toBeUndefined();
  });

  // A timestamp can never contain "|", so everything after the first one is id.
  it("splits on the first separator", () => {
    expect(decodeCursor(`${PG_TIMESTAMP}|a|b`)).toBeUndefined();
  });
});

describe("clampLimit", () => {
  it("falls back to the default when unspecified", () => {
    expect(clampLimit(undefined, 100, 500)).toBe(100);
  });

  it("clamps to the range rather than rejecting", () => {
    expect(clampLimit(0, 100, 500)).toBe(1);
    expect(clampLimit(-5, 100, 500)).toBe(1);
    expect(clampLimit(9999, 100, 500)).toBe(500);
  });

  it("truncates a fractional limit", () => {
    expect(clampLimit(10.9, 100, 500)).toBe(10);
  });
});
