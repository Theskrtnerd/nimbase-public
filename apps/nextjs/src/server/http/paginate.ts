import "server-only";

import type { SQL, SQLWrapper } from "@acme/db";
import { desc, sql } from "@acme/db";

import { clampLimit, decodeCursor, encodeCursor } from "./cursor";

/**
 * A row shaped for keyset pagination: its id, plus the exact Postgres text of
 * its sort timestamp. `cursorAt` is stripped before the rows are returned — it
 * exists only to build the next cursor.
 */
export interface PaginableRow {
  id: string;
  cursorAt: string;
}

export interface Page<T> {
  rows: T[];
  /** Pass back as `cursor` for the next page; null when this is the last one. */
  nextCursor: string | null;
}

export interface PaginateSpec {
  /** The `(createdAt desc, id desc)` sort columns the cursor keys off. */
  createdAt: SQLWrapper;
  id: SQLWrapper;
  limit?: number;
  cursor?: string;
  defaultLimit: number;
  maxLimit: number;
}

/**
 * Keyset pagination over a `(createdAt desc, id desc)` ordering.
 *
 * Owns everything that is identical for every paginated listing — clamping the
 * limit, building the strictly-after predicate, over-fetching by one to detect a
 * next page, and encoding the cursor — while the caller keeps full control of
 * its own select, joins, and scope filters. Each listing then adds two lines
 * instead of its own copy of this bookkeeping.
 */
export async function paginate<T extends PaginableRow>(
  spec: PaginateSpec,
  fetch: (args: {
    limit: number;
    keyset: SQL | undefined;
    orderBy: [SQL, SQL];
  }) => Promise<T[]>,
): Promise<Page<Omit<T, "cursorAt">>> {
  const limit = clampLimit(spec.limit, spec.defaultLimit, spec.maxLimit);
  const after = spec.cursor ? decodeCursor(spec.cursor) : undefined;

  // Postgres row comparison *is* the keyset predicate. Both values are bind
  // params, and decodeCursor has already validated their shapes — an unvalidated
  // cursor reaching these casts would make Postgres raise and surface as a 500.
  const keyset = after
    ? sql`(${spec.createdAt}, ${spec.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
    : undefined;

  // The ORDER BY is handed to the caller rather than left for it to write: the
  // keyset predicate above is only correct for this exact ordering, and a caller
  // that ordered differently would silently skip rows instead of failing.
  const orderBy: [SQL, SQL] = [desc(spec.createdAt), desc(spec.id)];

  // limit + 1: one extra row is the cheapest possible "is there more?" check.
  const fetched = await fetch({ limit: limit + 1, keyset, orderBy });
  const page = fetched.slice(0, limit);
  const last = page.at(-1);

  return {
    rows: page.map(({ cursorAt: _cursorAt, ...row }) => row),
    nextCursor:
      fetched.length > limit && last
        ? encodeCursor({ createdAt: last.cursorAt, id: last.id })
        : null,
  };
}
