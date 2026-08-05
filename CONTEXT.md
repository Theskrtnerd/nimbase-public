# Nimbase domain context

Nimbase is company memory infrastructure. Its product loop is **Capture →
Compile → Share**. This file is the canonical vocabulary for product and code
decisions; historical plans do not override it.

## Canonical terms

- **Workspace** — one company security boundary.
- **UserProfile** — the stable employee identity inside a workspace. A Clerk
  account, verified email aliases, and provider subjects resolve to it.
- **Source** — immutable captured evidence: the exact original plus normalized
  `raw.md`, provenance, and (for connector content) the access-policy snapshot
  observed when it was captured.
- **ProviderAccessPolicy** — immutable, content-addressed ACL snapshot copied
  from a provider. It is evaluated against current `UserProfileEmail` and
  `ExternalIdentity` bindings.
- **ProviderAccessResource** — the stable provider object whose current ACL
  governs one or more sources, such as a Drive file, Slack channel, Linear
  team, mail thread, or code repository. Its identity is scoped to one
  connection.
- **ProviderAccessObservation** — append-only evidence that a connector
  observed a new effective policy or lifecycle state for a
  `ProviderAccessResource`. Reverification of the same state advances resource
  freshness without duplicating history.
- **Access domain** — sources governed by the same current provider policy. It
  is a security fence, not a manually authored presentation or reader model.
- **Memory** — durable OKF markdown compiled from sources. Object storage is
  authoritative; Postgres is its derived retrieval index.
- **MemoryMutation** — an append-only record of one visible memory change,
  committed atomically with that change. It is the durable source for history
  projections and includes content, metadata, moves, and deletes.
- **Memory Git history** — one linear, standard Git commit history per
  workspace, derived from `MemoryMutation` records. It is portable audit and
  synchronization state, not a competing canonical memory store.
- **Held source** — provider evidence retained for authorized raw access but
  deliberately excluded from compilation until derived memory can preserve
  and evaluate changing policy safely.
- **Deployment** — a serving surface over memory: agent, MCP, widget, share, or
  artifact.
- **Folder anchor** — an optional legacy/path scope. It may narrow a deployment
  or capture but does not define company identity or provider authorization.

## Security rules

1. Provider authorization is derived from the provider, never invented by a
   prompt, folder name, deployment, or admin role.
2. Provider ACLs are applied before returning source metadata, raw evidence, or
   retrieval candidates. Workspace admins do not bypass restricted grants.
3. Unknown, partial, or missing provider identity data fails closed.
4. Source capture history is immutable. A policy-only change appends a provider
   access observation and changes the resource's current authorization fence;
   it does not rewrite captures or duplicate unchanged source bytes.
5. Derived memory may combine sources only when its compiler and evals can
   prove the resulting policy across later ACL changes. Until then, every
   provider source remains held.

## Explicitly retired

The former **Audience** model—lenses, projected KBs, per-reader rewrites, and
fan-out compilation—is not part of Nimbase. Governance is identity plus
provider-derived policy over one centralized company knowledge base.
