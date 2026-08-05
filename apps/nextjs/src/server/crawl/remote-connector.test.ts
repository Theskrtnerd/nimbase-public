import { afterEach, describe, expect, it, vi } from "vitest";

import { remoteConnector } from "./remote-connector";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn<
    (
      url: URL,
      init: {
        headers?: Record<string, string>;
        allowPrivateNetwork?: boolean;
      },
    ) => Promise<Response>
  >(),
  readResponseText:
    vi.fn<(response: Response, maxBytes: number) => Promise<string>>(),
  env: { NIMBASE_ALLOW_PRIVATE_CONNECTORS: false },
}));

vi.mock("@acme/runtime/safe-http", () => ({
  safeFetch: mocks.safeFetch,
  readResponseText: mocks.readResponseText,
}));
vi.mock("~/env", () => ({ env: mocks.env }));

const context = {
  endpointUrl: "https://connector.example",
  secret: "shared-secret",
};

describe("remote connector adapter", () => {
  afterEach(() => {
    mocks.env.NIMBASE_ALLOW_PRIVATE_CONNECTORS = false;
    vi.clearAllMocks();
  });

  it("fetches and validates the connector manifest without redirects", async () => {
    mocks.safeFetch.mockResolvedValue(new Response("{}"));
    mocks.readResponseText.mockResolvedValue(
      JSON.stringify({
        protocolVersion: 1,
        id: "example/issues",
        label: "Example Issues",
      }),
    );

    await expect(remoteConnector.manifest(context)).resolves.toMatchObject({
      id: "example/issues",
    });
    const [url, init] = mocks.safeFetch.mock.calls[0] ?? [];
    expect(url).toEqual(
      new URL("https://connector.example/.well-known/nimbase-connector.json"),
    );
    expect(init).toMatchObject({
      redirect: "error",
      allowPrivateNetwork: false,
    });
    expect(new Headers(init?.headers as HeadersInit).get("authorization")).toBe(
      "Bearer shared-secret",
    );
  });

  it("passes the private-network opt-in only when the operator enables it", async () => {
    mocks.env.NIMBASE_ALLOW_PRIVATE_CONNECTORS = true;
    mocks.safeFetch.mockResolvedValue(new Response("{}"));
    mocks.readResponseText.mockResolvedValue(
      JSON.stringify({
        protocolVersion: 1,
        id: "example/issues",
        label: "Example Issues",
      }),
    );
    await remoteConnector.manifest(context);
    expect(mocks.safeFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ allowPrivateNetwork: true }),
    );
  });

  it("rejects malformed connector output", async () => {
    mocks.safeFetch.mockResolvedValue(new Response("{}"));
    mocks.readResponseText.mockResolvedValue(JSON.stringify({ items: [] }));
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
    mocks.safeFetch.mockResolvedValue(new Response("{}"));
    mocks.readResponseText.mockRejectedValue(
      new Error("outbound response exceeds the size limit"),
    );
    await expect(remoteConnector.manifest(context)).rejects.toThrow(
      "outbound response exceeds the size limit",
    );
  });
});
