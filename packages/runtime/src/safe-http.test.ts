import { createServer } from "node:http";
import { Response } from "undici";
import { afterEach, describe, expect, it } from "vitest";

import { readResponseText, safeFetch } from "./safe-http";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("safeFetch", () => {
  it("rejects plaintext and credential-bearing public URLs", async () => {
    await expect(safeFetch("http://example.com")).rejects.toThrow(
      "must use HTTPS",
    );
    await expect(
      safeFetch("https://user:password@example.com"),
    ).rejects.toThrow("cannot contain credentials");
  });

  it("rejects a literal private destination before connecting", async () => {
    try {
      await safeFetch("https://127.0.0.1");
      throw new Error("expected private destination to be rejected");
    } catch (error) {
      const cause =
        error instanceof Error && "cause" in error
          ? String(error.cause)
          : String(error);
      expect(cause).toContain("non-public address");
    }
  });

  it("allows an operator-opted-in private connector", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end('{"ok":true}');
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing port");

    const response = await safeFetch(`http://127.0.0.1:${address.port}`, {
      allowPrivateNetwork: true,
    });
    await expect(readResponseText(response, 100)).resolves.toBe('{"ok":true}');
  });
});

describe("readResponseText", () => {
  it("rejects declared and streamed bodies over the byte cap", async () => {
    await expect(
      readResponseText(
        new Response("small", { headers: { "content-length": "100" } }),
        10,
      ),
    ).rejects.toThrow("size limit");
    await expect(
      readResponseText(new Response("x".repeat(11)), 10),
    ).rejects.toThrow("size limit");
  });
});
