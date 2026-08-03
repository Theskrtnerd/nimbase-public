import { afterEach, describe, expect, it, vi } from "vitest";

import { remoteConnector } from "./remote-connector";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(() =>
    Promise.resolve([{ address: "93.184.216.34", family: 4 as const }]),
  ),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

const context = {
  endpointUrl: "https://connector.example",
  secret: "shared-secret",
};

describe("remote connector adapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches and validates the connector manifest without redirects", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            protocolVersion: 1,
            id: "example/issues",
            label: "Example Issues",
          }),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(remoteConnector.manifest(context)).resolves.toMatchObject({
      id: "example/issues",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(
      new URL("https://connector.example/.well-known/nimbase-connector.json"),
    );
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer shared-secret",
    );
  });

  it("rejects insecure non-local connector endpoints", async () => {
    await expect(
      remoteConnector.manifest({
        endpointUrl: "http://connector.example",
        secret: null,
      }),
    ).rejects.toThrow("connector endpoint must use HTTPS");
  });

  it("rejects endpoints resolving to a private address", async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(remoteConnector.manifest(context)).rejects.toThrow(
      "connector endpoint resolves to a non-public address",
    );
  });

  it("rejects malformed connector output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [] })))),
    );
    await expect(
      remoteConnector.pull(context, {
        protocolVersion: 1,
        connectionId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
        cursor: null,
        configuration: {},
        limit: 100,
      }),
    ).rejects.toThrow();
  });

  it("stops reading a connector response beyond the byte limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("x".repeat(12_000_001), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    await expect(remoteConnector.manifest(context)).rejects.toThrow(
      "connector response exceeds the size limit",
    );
  });
});
