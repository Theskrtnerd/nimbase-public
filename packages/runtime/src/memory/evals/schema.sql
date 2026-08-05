-- Minimal PGlite schema for the retrieval eval. Hand-written to match the
-- @acme/db drizzle schema (snake_case) for exactly the tables the MemoryProvider
-- read + write paths touch: the wiki tree, its versions/chunks/tags/sources, and
-- the workspace + spend rows their foreign keys and best-effort accounting need.
-- Regenerate awareness: if packages/db/src/schema.ts changes any of these
-- columns, update this file (the eval seeds through the real provider, so a
-- drift surfaces as an insert error). pgvector + FTS indexes mirror the
-- out-of-band migrations packages/db/sql/000{1,2}_*.sql.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  slug text NOT NULL,
  description text,
  website text,
  brain_init_status text NOT NULL DEFAULT 'pending',
  owner_user_id text NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamptz
);

CREATE UNIQUE INDEX workspace_slug_idx ON workspace (slug);

CREATE TABLE source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind text NOT NULL,
  source_url text,
  title text,
  s3_key_original text NOT NULL,
  s3_key_raw_md text,
  status text NOT NULL DEFAULT 'queued',
  captured_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE wiki_node (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  path text NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  current_version_id uuid,
  deleted_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  restricted boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz
);

CREATE UNIQUE INDEX wiki_node_workspace_path_idx
  ON wiki_node (workspace_id, path)
  WHERE deleted_at IS NULL;

CREATE TABLE wiki_node_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES wiki_node(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  s3_key text NOT NULL,
  summary text,
  source_id uuid REFERENCES source(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE wiki_chunk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_version_id uuid NOT NULL REFERENCES wiki_node_version(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  ord integer NOT NULL,
  text text NOT NULL,
  embedding vector(1536) NOT NULL
);

CREATE TABLE wiki_node_tag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES wiki_node(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX wiki_node_tag_node_tag_idx ON wiki_node_tag (node_id, tag);

CREATE TABLE wiki_node_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES wiki_node(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX wiki_node_source_node_source_idx
  ON wiki_node_source (node_id, source_id);

CREATE TABLE spend_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind text NOT NULL,
  cents bigint NOT NULL,
  job_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Keyword half of hybrid search (mirrors packages/db/sql/0002_hybrid_search.sql):
-- a functional GIN over each chunk's english tsvector, covering the `@@` filter
-- and ts_rank_cd in the hybrid query.
CREATE INDEX wiki_chunk_text_search_gin
  ON wiki_chunk USING gin (to_tsvector('english', text));
