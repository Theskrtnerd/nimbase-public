# Nimbase Connector SDK

`@nimbase/connector-sdk` contains the versioned JSON contracts used by
out-of-process Nimbase sync connectors. A connector exposes a manifest, a pull
endpoint, and optionally a scope-discovery endpoint. Nimbase owns scheduling,
retry, deduplication, ingestion, and permission enforcement; the connector owns
provider authentication, pagination, and normalization.

See `docs/connectors.md` in the Nimbase repository for the protocol and a
reference implementation.

## Install

```sh
npm install @nimbase/connector-sdk
```

Releases use `connector-v<version>` tags and npm trusted publishing.
