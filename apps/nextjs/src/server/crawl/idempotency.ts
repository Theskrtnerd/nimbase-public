import { createHash } from "node:crypto";
import type { ConnectorItem } from "@nimbase/connector-sdk";

// The idempotency key is the connector item's stable identity plus content
// revision. Unchanged items skip insertion; changed items compile again.
export function buildIdempotencyKey(args: {
  provider: string;
  connectionId: string;
  externalId: string;
  contentHash: string;
}): string {
  return `${args.provider}:${args.connectionId}:${args.externalId}:${args.contentHash}`;
}

// A stable hash over the fields that define an item's version. This helper is
// useful to in-process tests and connector implementations that share source.
export function hashItemContent(parts: {
  externalId: string;
  updatedAt: string;
  body: string;
}): string {
  return createHash("sha256")
    .update(parts.externalId)
    .update("\0")
    .update(parts.updatedAt)
    .update("\0")
    .update(parts.body)
    .digest("hex")
    .slice(0, 32);
}

export function idempotencyKeyForItem(
  provider: string,
  connectionId: string,
  item: ConnectorItem,
): string {
  return buildIdempotencyKey({
    provider,
    connectionId,
    externalId: item.externalId,
    contentHash: item.contentHash,
  });
}
