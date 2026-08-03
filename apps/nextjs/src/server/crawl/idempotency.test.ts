import type { ConnectorItem } from "@nimbase/connector-sdk";
import { describe, expect, it } from "vitest";

import {
  buildIdempotencyKey,
  hashItemContent,
  idempotencyKeyForItem,
} from "./idempotency";

describe("buildIdempotencyKey", () => {
  it("joins the identity parts in a stable order", () => {
    expect(
      buildIdempotencyKey({
        provider: "linear",
        connectionId: "c1",
        externalId: "ENG-42",
        contentHash: "abc",
      }),
    ).toBe("linear:c1:ENG-42:abc");
  });
});

describe("hashItemContent", () => {
  const base = {
    externalId: "ENG-42",
    updatedAt: "2026-07-07T00:00:00Z",
    body: "In Progress",
  };

  it("is deterministic", () => {
    expect(hashItemContent(base)).toBe(hashItemContent({ ...base }));
  });

  it("changes when the body changes (status flip → re-compile)", () => {
    expect(hashItemContent(base)).not.toBe(
      hashItemContent({ ...base, body: "Done" }),
    );
  });

  it("changes when updatedAt changes", () => {
    expect(hashItemContent(base)).not.toBe(
      hashItemContent({ ...base, updatedAt: "2026-07-08T00:00:00Z" }),
    );
  });
});

describe("idempotencyKeyForItem", () => {
  it("keeps the key stable for an unchanged item and shifts it when content changes", () => {
    const item: ConnectorItem = {
      externalId: "ENG-42",
      title: "Fix login",
      markdown: "status: in progress",
      updatedAt: "2026-07-07T00:00:00Z",
      contentHash: "hash-v1",
      kind: "web",
    };
    const k1 = idempotencyKeyForItem("linear", "c1", item);
    const k2 = idempotencyKeyForItem("linear", "c1", { ...item });
    const k3 = idempotencyKeyForItem("linear", "c1", {
      ...item,
      contentHash: "hash-v2",
    });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});
