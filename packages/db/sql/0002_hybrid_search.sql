-- 0002_hybrid_search.sql
-- Keyword half of hybrid search. Index-only (no column), mirroring the
-- HNSW setup in 0001_enable_pgvector.sql. drizzle-kit push does not manage
-- extensions/indexes, so this is applied out-of-band and kept here for
-- reproducibility. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Functional GIN index over the computed tsvector of each chunk's text.
-- Covers both the `@@` filter and ts_rank_cd in the hybrid query.
CREATE INDEX IF NOT EXISTS wiki_chunk_text_search_gin
  ON wiki_chunk USING gin (to_tsvector('english', text));
