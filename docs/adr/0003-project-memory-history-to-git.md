# ADR 0003: Project durable memory mutations into Git

- Status: accepted
- Date: 2026-08-06

## Context

Nimbase stores canonical OKF bodies in object storage and uses Postgres as its
live tree and derived retrieval index. Immutable `WikiNodeVersion` rows retain
prior bodies, but they do not describe path moves or deletes and do not form a
portable history that a customer can later mirror to a Git host.

Making a Git repository the canonical write path would couple every memory
mutation to object construction, ref coordination, and eventually a remote
provider. A transient GitHub or object-store failure could then reject an
otherwise valid memory update. Serverless workers also cannot rely on a local
checkout surviving between invocations.

The history must capture all user-visible VFS mutations, remain recoverable
after dispatch failures, preserve the existing OKF and Postgres invariants,
and produce real Git objects that can be pushed without rewriting history.

## Decision

Add `MemoryMutation` as the append-only history contract. Each OKF version
write, metadata write, subtree move, and subtree delete inserts one mutation in
the same database batch that makes the memory change visible. A mutation
references immutable wiki versions for content and records path operations for
moves and deletes. Those batches lock the workspace row before mutating memory,
so mutation sequence agrees with committed write order under concurrent writers.

Maintain one linear Memory Git history per workspace. A retryable projector
replays pending mutations in sequence, writes standard compressed Git blobs,
trees, and commits to object storage, and advances a materialized workspace ref
with compare-and-swap. Object writes are content-addressed and idempotent. The
projector records the resulting commit id on the mutation only when the ref
advance succeeds.

Projection is downstream of the journal. Queue publication, object storage, or
projection failures leave a visible pending mutation with retry information;
they do not roll back canonical memory. A worker invocation drains all pending
mutations for its workspace, so a later dispatch also recovers earlier missed
notifications. Existing workspaces receive one baseline mutation containing
their current live notes during the additive schema migration, and the
migration command drains all pending workspaces before it finishes.

Git commit identity is the stable system identity `Nimbase Memory`. Source and
compile job identifiers remain structured journal attribution and are not
embedded into commit messages. Postgres and OKF object storage remain the
canonical memory write path. Git is portable audit and synchronization state.

## Consequences

- Every successful VFS mutation has a durable record even when Git projection
  is temporarily unavailable.
- Moves and deletes become part of history instead of being inferred from
  snapshots.
- A future GitHub adapter can push the exact stored object graph and ref rather
  than manufacture a new history.
- Local disk and a Git binary are not required in serverless production.
- The journal and projection state add storage and operational monitoring.
- Git history is eventually consistent with live memory. Consumers that need
  read-after-write memory continue to use the canonical VFS, not the Git ref.
- A workspace's mutations are linearized by their durable sequence. Concurrent
  writers do not create branches; compare-and-swap retries ref contention.
