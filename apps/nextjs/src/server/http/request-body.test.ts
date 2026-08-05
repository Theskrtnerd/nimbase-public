import { describe, expect, it } from "vitest";

import { readJsonRequest, RequestBodyError } from "./request-body";

describe("readJsonRequest", () => {
  it("parses a bounded JSON body", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });
    await expect(readJsonRequest(request, 100)).resolves.toEqual({ ok: true });
  });

  it("rejects declared and streamed bodies over the cap", async () => {
    const declared = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "101" },
      body: "{}",
    });
    await expect(readJsonRequest(declared, 100)).rejects.toMatchObject({
      status: 413,
    });

    const streamed = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(101) }),
    });
    await expect(readJsonRequest(streamed, 100)).rejects.toBeInstanceOf(
      RequestBodyError,
    );
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: "not json",
    });
    await expect(readJsonRequest(request, 100)).rejects.toMatchObject({
      status: 400,
    });
  });
});
