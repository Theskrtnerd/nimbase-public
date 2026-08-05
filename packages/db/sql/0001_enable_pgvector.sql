-- 0001_enable_pgvector.sql
-- Vector half of hybrid search. Enables pgvector and the HNSW ANN index over
-- wiki_chunk.embedding. drizzle-kit push does not manage extensions/indexes,
-- so this is applied out-of-band and kept here for reproducibility.
--
-- ORDERING when standing up a fresh database:
--   1. CREATE EXTENSION below MUST run BEFORE `drizzle-kit push` — the
--      wiki_chunk.embedding vector(1536) column cannot be created until the
--      `vector` type exists.
--   2. The HNSW index needs the wiki_chunk table, so it runs AFTER push.
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

-- Cosine-distance ANN index matching the `<=>` operator used in
-- packages/runtime/src/search.ts. Created after the table exists (post-push).
CREATE INDEX IF NOT EXISTS wiki_chunk_embedding_hnsw
  ON wiki_chunk USING hnsw (embedding vector_cosine_ops);
