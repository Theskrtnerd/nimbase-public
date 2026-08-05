import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";

import type { Db } from "@acme/db/client";
import * as schema from "@acme/db/schema";

// A PGlite-backed drizzle handle carrying the real @acme/db schema, so the
// unmodified production search SQL (pgvector HNSW/KNN + FTS + RRF) and the wiki
// write path run in-process against it. The eval points @acme/db/client at this
// via setDbOverride. PGlite is real Postgres compiled to WASM, so pgvector's
// `<=>` and the english FTS functions behave identically to Neon.

const DDL = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export interface EvalDb {
  // Typed as the production `Db` handle, not `PgliteDatabase`, so the eval seeds
  // and queries through the exact builder surface production code uses and
  // `setDbOverride` (which takes `Db`) accepts it directly. Adding pglite to
  // this package gives drizzle-orm a second, pglite-keyed copy whose types are
  // nominally distinct from @acme/db's; the two share one query-builder API and
  // only the driver differs, so this is the single boundary where the pglite
  // handle is presented as the standard handle (see the cast in createEvalDb).
  db: Db;
  close: () => Promise<void>;
}

export async function createEvalDb(): Promise<EvalDb> {
  const pglite = await PGlite.create({ extensions: { vector } });
  await pglite.exec(DDL);

  // Best-effort HNSW index — matches the production index (packages/db/sql/
  // 0001_enable_pgvector.sql) so the query plan mirrors prod. For the tiny eval
  // corpus an exact KNN seq-scan returns identical rows, so if this build of
  // pgvector lacks HNSW we proceed without it.
  try {
    await pglite.exec(
      `CREATE INDEX wiki_chunk_embedding_hnsw ON wiki_chunk
         USING hnsw (embedding vector_cosine_ops);`,
    );
  } catch {
    // No HNSW in this pgvector build — exact KNN still gives identical results.
  }

  // One boundary cast (see EvalDb.db): the pglite driver's drizzle handle is
  // structurally the same query builder over the same schema as the production
  // Neon handle; only the transport differs. `unknown` first because the two
  // drizzle-orm copies declare nominally distinct private members.
  const pgliteDb = drizzle({ client: pglite, schema, casing: "snake_case" });
  // Neon exposes `batch`, which the production memory write path uses for its
  // atomic journal contract. The PGlite drizzle adapter does not. This eval is
  // deliberately single-writer, so execute the already-built statements in
  // order at this test-only transport seam. Production never uses this shim;
  // its real `db.batch` remains one transaction.
  const evalDb = Object.assign(pgliteDb, {
    batch: async (statements: PromiseLike<unknown>[]) => {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement);
      return results;
    },
  });
  return { db: evalDb as unknown as Db, close: () => pglite.close() };
}
