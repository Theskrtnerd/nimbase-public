import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// The production driver type. The test/eval seam (`setDbOverride`) accepts any
// drizzle handle over the same schema — the offline retrieval eval points this
// at a PGlite-backed instance so the real search SQL runs in-process — so it is
// widened to this alias there.
export type Db = NeonHttpDatabase<typeof schema>;

let neon: Db | null = null;
let postgres: Db | null = null;
let override: Db | null = null;

export type DatabaseDriver = "neon" | "postgres";

export function databaseDriver(): DatabaseDriver {
  const value = process.env.NIMBASE_DATABASE_DRIVER ?? "neon";
  if (value === "neon" || value === "postgres") return value;
  throw new Error(
    `Invalid NIMBASE_DATABASE_DRIVER: expected "neon" or "postgres", received "${value}"`,
  );
}

// Lazily construct the real Neon HTTP driver on first use. Kept lazy so a
// process that only ever runs against an injected handle (the PGlite eval) never
// needs POSTGRES_URL; production sets it, so the first query constructs the
// driver exactly as before.
function neonDb(): Db {
  if (!neon) {
    if (!process.env.POSTGRES_URL) {
      throw new Error("Missing POSTGRES_URL");
    }
    neon = drizzle(process.env.POSTGRES_URL, {
      schema,
      casing: "snake_case",
    });
  }
  return neon;
}

function postgresDb(): Db {
  if (!postgres) {
    if (!process.env.POSTGRES_URL) {
      throw new Error("Missing POSTGRES_URL");
    }
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    // Both Drizzle adapters expose the query interface used by consumers, but
    // their nominal execute result types differ. Keep that variance at this
    // adapter seam instead of spreading a driver union through every caller.
    postgres = drizzlePostgres(pool, {
      schema,
      casing: "snake_case",
    }) as unknown as Db;
  }
  return postgres;
}

function configuredDb(): Db {
  return databaseDriver() === "postgres" ? postgresDb() : neonDb();
}

// Test/eval-only seam: point every `@acme/db/client` consumer at an alternate
// drizzle handle (the retrieval eval uses a PGlite-backed instance so the real
// search + write SQL runs offline). Production NEVER calls this — `db` defaults
// to the Neon HTTP driver. Pass `null` to restore the default.
export function setDbOverride(handle: Db | null): void {
  override = handle;
}

// A stable exported binding whose property access forwards to the active handle
// (the override when set, else the Neon driver). Consumers `import { db }` once
// and hold this proxy; the indirection lets the eval swap the backing store
// without every importer re-reading the binding. In production the override is
// never set, so this is a thin pass-through to the Neon driver.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const active = override ?? configuredDb();
    // Resolve against the real handle (receiver = active) so any getter runs
    // with the correct `this`; bind methods to it so later calls keep it.
    const value: unknown = Reflect.get(active as object, prop, active);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(active)
      : value;
  },
});
