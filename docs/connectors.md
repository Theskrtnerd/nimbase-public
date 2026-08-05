# Building a Nimbase connector

Community Edition keeps sync orchestration in the core and runs provider logic
out of process. A connector implements the versioned JSON contracts from
`@nimbase/connector-sdk`; it owns provider authentication, pagination, rate
limits, and normalization. Nimbase owns schedules, retries, idempotency,
permission enforcement, and ingestion.

## Minimal connector

```ts
import {
  CONNECTOR_PROTOCOL_VERSION,
  createConnectorHandler,
} from "@nimbase/connector-sdk";

export const handleConnectorRequest = createConnectorHandler({
  manifest: {
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
    id: "acme/issues",
    label: "Acme Issues",
    scopeKind: null,
    supportsScopes: false,
  },
  authorize(request) {
    return (
      request.headers.get("authorization") ===
      `Bearer ${process.env.CONNECTOR_SECRET}`
    );
  },
  async pull(request) {
    const items = await loadIssuesAfter(request.cursor, request.limit);
    const projects = uniqueProjects(items);
    return {
      protocolVersion: CONNECTOR_PROTOCOL_VERSION,
      accessResources: projects.map((project) => ({
        kind: "project",
        externalId: project.id,
        name: project.name,
        state: "active",
        accessPolicy: project.accessPolicy,
      })),
      items: items.map((issue) => ({
        externalId: issue.id,
        title: issue.title,
        markdown: issue.markdown,
        sourceUrl: issue.url,
        updatedAt: issue.updatedAt,
        contentHash: issue.revision,
        kind: "web",
        accessResource: { kind: "project", externalId: issue.projectId },
      })),
      nextCursor: items.at(-1)?.updatedAt ?? request.cursor,
      hasMore: items.length === request.limit,
    };
  },
});
```

Mount the returned Fetch-compatible handler at all paths on the connector's
origin. Nimbase reads `/.well-known/nimbase-connector.json`, calls `/v1/pull`,
and calls `/v1/scopes` when the manifest advertises scope discovery.

## Register it

```sh
export ACME_CONNECTOR_SECRET="replace-me"
nimbase sync add https://connector.example \
  --secret-env ACME_CONNECTOR_SECRET \
  --config '{"project":"engineering"}' \
  --interval 3600
nimbase sync run acme/issues --wait
```

Connector endpoints must use HTTPS. Plain HTTP is accepted only for localhost
development. Responses are schema-validated, redirects are rejected, and pull
responses are capped at 12 MB and 2,000 items. Non-local endpoints must resolve
only to public IP addresses. Registering connectors requires manage permission
on their target folder; operators should still run only connector code they
trust.

## Permission rules

A connection is anchored to one Nimbase folder. Connector-provided access
policies may narrow visibility inside that folder but never widen the caller's
folder grants. Omit access resources when the connection's ordinary workspace
and folder permissions are authoritative. Items linked to an access resource
are held as governed source evidence until permission-preserving compilation is
enabled.

An access resource is the provider object whose ACL governs one or more content
items. Emit an `active` observation with its complete current policy, or emit
`inaccessible`/`deleted` as soon as the provider reports that lifecycle change.
An observation may be returned even when `items` is empty, so ACL changes never
depend on a content revision. Multiple items may reference the same resource.
An item may reference a resource observed in the same or an earlier pull. When
migrating from item-level policies to shared resources, replay every item once
with its resource reference so Nimbase can rebind historical captures; stable
content hashes prevent duplicate source storage.

Protocol-v1 connectors may still put `accessPolicy` directly on an item while
they migrate. That compatibility form treats the content item itself as its ACL
resource and therefore cannot mirror ACL-only changes. Do not provide both
`accessResource` and `accessPolicy` on one item.

Treat cursors as opaque JSON. Return a cursor only after every preceding item
has been included so retries cannot skip data. `contentHash` must change when
the normalized source changes; Nimbase uses it for idempotency.
