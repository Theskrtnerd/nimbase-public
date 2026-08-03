import { describe, expect, it } from "vitest";

import {
  CONNECTOR_PULL_PATH,
  connectorManifestSchema,
  connectorPullResponseSchema,
  createConnectorHandler,
} from "./index";

describe("connector wire contracts", () => {
  it("accepts a versioned manifest with an extensible connector id", () => {
    expect(
      connectorManifestSchema.parse({
        protocolVersion: 1,
        id: "example/issues",
        label: "Example Issues",
      }),
    ).toMatchObject({
      id: "example/issues",
      scopeKind: null,
      supportsScopes: false,
    });
  });

  it("rejects unversioned or malformed pull output", () => {
    expect(() =>
      connectorPullResponseSchema.parse({ items: [], nextCursor: null }),
    ).toThrow();
    expect(() =>
      connectorPullResponseSchema.parse({
        protocolVersion: 1,
        items: [{ externalId: "missing-required-fields" }],
        nextCursor: null,
        hasMore: false,
      }),
    ).toThrow();
  });

  it("serves a connector through the Fetch-compatible handler", async () => {
    const handler = createConnectorHandler({
      manifest: {
        protocolVersion: 1,
        id: "example/issues",
        label: "Example Issues",
        scopeKind: null,
        supportsScopes: false,
      },
      authorize: (request) =>
        request.headers.get("authorization") === "Bearer test-secret",
      pull: (request) => ({
        protocolVersion: 1,
        items: [
          {
            externalId: "ISSUE-1",
            title: "Example issue",
            markdown: "# Example issue",
            updatedAt: "2026-08-04T00:00:00.000Z",
            contentHash: "revision-1",
            kind: "web",
          },
        ],
        nextCursor: request.cursor,
        hasMore: false,
      }),
    });
    const response = await handler(
      new Request(`https://connector.example${CONNECTOR_PULL_PATH}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          protocolVersion: 1,
          connectionId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
          cursor: null,
          configuration: {},
          limit: 100,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ externalId: "ISSUE-1" }],
    });
  });

  it("rejects invalid JSON without invoking the connector", async () => {
    const handler = createConnectorHandler({
      manifest: {
        protocolVersion: 1,
        id: "example/issues",
        label: "Example Issues",
        scopeKind: null,
        supportsScopes: false,
      },
      pull: () => {
        throw new Error("pull must not run");
      },
    });
    const response = await handler(
      new Request(`https://connector.example${CONNECTOR_PULL_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });

  it("reports invalid connector output as an implementation failure", async () => {
    const handler = createConnectorHandler({
      manifest: {
        protocolVersion: 1,
        id: "example/issues",
        label: "Example Issues",
        scopeKind: null,
        supportsScopes: false,
      },
      pull: () => ({ items: [] }) as never,
    });
    const response = await handler(
      new Request(`https://connector.example${CONNECTOR_PULL_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          connectionId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
          cursor: null,
          configuration: {},
          limit: 100,
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "connector_failed",
    });
  });
});
