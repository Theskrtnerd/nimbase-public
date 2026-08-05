# ADR 0002: Mirror provider ACL resources independently from content

- Status: accepted
- Date: 2026-08-06
- Issue: https://github.com/Theskrtnerd/nimbase-public/issues/8

## Context

ADR 0001 attached a current provider policy directly to every `Source` and
updated all historical rows for an external item when a crawl observed a new
policy. That closed old raw evidence after an ACL tightened, but it conflated
three identities that providers frequently keep separate:

- the content item Nimbase captures, such as a Slack thread or Linear issue;
- the object whose ACL is authoritative, such as a Slack channel or Linear
  team; and
- the immutable policy snapshot observed at capture time.

Item-level policies also cannot report an ACL-only change when connector
content is unchanged. Rewriting historical source rows discards which policy
was observed for a particular capture and creates pressure to duplicate source
bytes merely to record a governance change.

## Decision

Introduce `ProviderAccessResource` as the stable, connection-scoped identity of
the provider object whose ACL governs content. A resource has one current
policy and lifecycle state. Every `Source` captured from a provider links to
its resource and retains its original policy snapshot as immutable audit
evidence.

Authorization of linked sources follows the resource's current state and
policy. Deleted or explicitly inaccessible resources fail closed. A missing
resource link on legacy provider evidence continues to use its conservative
source policy until migration or a later connector observation establishes the
resource.

When a connector reports that a content item belongs to a resource, Nimbase
rebinds every historical capture of that item to the resource before content
deduplication. This current-authorization pointer may change when a provider
moves an item between security containers; source bytes and capture-time policy
snapshots remain immutable. Connector migrations from item policies to shared
resources must replay each item binding once, but unchanged content is not
stored again.

The first observation and every effective policy or lifecycle transition append
a `ProviderAccessObservation` and update the resource's current state. A
repeated identical observation only advances `lastVerifiedAt`. Policy rows
remain canonical and content-addressed. An ACL-only observation does not create
a `Source`, upload content, consume capture entitlement, or enqueue compilation.

The core does not add the connection creator, workspace owner, administrator,
or operator to a mirrored policy. A connector may report only identities that
the provider proves. Partial policies authorize their known grants and fail
closed for every unresolved identity.

Extend the connector pull protocol additively:

- pull responses may contain access-resource observations independent of
  content items;
- content items may reference one observed resource; and
- the legacy item-level `accessPolicy` remains valid while connectors migrate.

The connector owns provider authentication, ACL discovery, pagination, and
normalization. The Nimbase core owns resource identity, canonical policy
persistence, governance history, source linkage, current authorization, and
fail-closed lifecycle behavior. Provider APIs and credentials remain outside
Community Edition.

## Consequences

- One policy boundary can govern many content items without duplicating ACLs.
- ACL-only changes are mirrored without re-downloading or duplicating content.
- Historical captures retain the policy observed when each capture occurred.
- Current provider authorization can tighten or revoke all linked captures in
  one place.
- Connector authors get one provider-neutral contract for future integrations.
- Existing connectors can migrate incrementally through the legacy item-policy
  compatibility path.
- Freshness expiry after transient provider failures remains a separate policy;
  this decision models explicit observations and lifecycle changes first.
