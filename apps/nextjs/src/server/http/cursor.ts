import "server-only";

import { isUuidParam } from "./params";

/**
 * Keyset cursors over a `(createdAt desc, id desc)` ordering.
 *
 * Keyset rather than offset: a row inserted mid-pagination shifts every offset
 * after it, which makes pages repeat or skip rows. Encoding the last row's sort
 * key instead means "everything strictly after this row" is stable no matter
 * what else lands. `id` is the tie-break, so rows sharing a timestamp still
 * have a total order.
 *
 * `createdAt` is the timestamp's exact Postgres text (`created_at::text`), NOT
 * an ISO string built from a JS Date. Postgres keeps microseconds
 * ("...376593+00") while a JS Date truncates to milliseconds — round-tripping
 * through Date lost those digits, so the boundary comparison never matched the
 * row it came from and every row sharing that millisecond was silently skipped.
 *
 * The format is opaque to clients; they only ever round-trip it.
 */
export interface CursorKey {
  /** Exact `created_at::text` from Postgres, microseconds included. */
  createdAt: string;
  id: string;
}

/**
 * Accepts both Postgres text form ("2026-07-25 08:49:41.376593+00") and ISO
 * ("2026-07-25T08:49:41.376Z"). Validated before it is ever cast to timestamptz:
 * an unchecked value would make Postgres raise on a hand-edited cursor, which is
 * exactly the malformed-input-becomes-500 failure this codebase guards against.
 */
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

export function encodeCursor(key: CursorKey): string {
  return `${key.createdAt}|${key.id}`;
}

/**
 * Returns undefined for anything unparseable. Callers treat that as "no cursor"
 * and restart the listing: a stale or hand-edited cursor should not fail the
 * request.
 *
 * Split on the FIRST separator — a timestamp can never contain "|", so
 * everything after it belongs to the id.
 */
export function decodeCursor(cursor: string): CursorKey | undefined {
  const separator = cursor.indexOf("|");
  if (separator === -1) return undefined;
  const createdAt = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!TIMESTAMP.test(createdAt) || !isUuidParam(id)) return undefined;
  return { createdAt, id };
}

/**
 * Clamp a caller-supplied page size into range, falling back to the default
 * when it is absent.
 */
export function clampLimit(
  requested: number | undefined,
  defaultLimit: number,
  maxLimit: number,
): number {
  if (requested === undefined) return defaultLimit;
  return Math.min(Math.max(Math.trunc(requested), 1), maxLimit);
}
