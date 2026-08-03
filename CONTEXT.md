# Nimbase domain context

Nimbase is company memory infrastructure. Its product loop is **Capture →
Compile → Share**. This file is the canonical vocabulary for product and code
decisions; historical plans do not override it.

## Canonical terms

- **Workspace** — one company security and billing boundary.
- **UserProfile** — the stable employee identity inside a workspace. A Clerk
  account, verified email aliases, and provider subjects resolve to it.
- **Source** — immutable captured evidence: the exact original plus normalized
  `raw.md`, provenance, and (for connector content) an access-policy snapshot.
- **ProviderAccessPolicy** — immutable, content-addressed ACL snapshot copied
  from a provider when a source is captured. It is evaluated against current
  `UserProfileEmail` and `ExternalIdentity` bindings.
- **Access domain** — sources with the same provider-policy fingerprint. It is
  a security fence, not a manually authored presentation or reader model.
- **Memory** — durable OKF markdown compiled from sources. Object storage is
  authoritative; Postgres is its derived retrieval index.
- **Held source** — provider evidence retained for authorized raw access but
  deliberately excluded from compilation until derived memory can preserve
  and evaluate changing policy safely.
- **Deployment** — a serving surface over memory: agent, MCP, docs, or artifact.
  Slack and widget are agent interfaces.
- **Folder anchor** — an optional legacy/path scope. It may narrow a deployment
  or capture but does not define company identity or provider authorization.

## Security rules

1. Provider authorization is derived from the provider, never invented by a
   prompt, folder name, deployment, or admin role.
2. Provider ACLs are applied before returning source metadata, raw evidence, or
   retrieval candidates. Workspace admins and Nimbase operators do not bypass
   restricted grants.
3. Unknown, partial, or missing provider identity data fails closed.
4. Policy changes re-fence existing source history and create new evidence even
   if content did not change.
5. Derived memory may combine sources only when its compiler and evals can
   prove the resulting policy across later ACL changes. Until then, every
   provider source remains held.

## Explicitly retired

The former **Audience** model—lenses, projected KBs, per-reader rewrites, and
fan-out compilation—is not part of Nimbase. Governance is identity plus
provider-derived policy over one centralized company knowledge base.
