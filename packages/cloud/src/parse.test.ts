import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isParseableMime, parseBytes, ParseError } from "./parse";

// Every test drives a stubbed fetch — the suite never reaches api.context.dev.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CONTEXT_DEV_API_KEY", "ctxt_secret_test");
  vi.stubEnv("AI_GATEWAY_API_KEY", "gw");
  vi.stubEnv("NIMBASE_S3_BUCKET", "b");
  vi.stubEnv("NIMBASE_S3_REGION", "r");
  vi.stubEnv("NIMBASE_AWS_ACCESS_KEY_ID", "k");
  vi.stubEnv("NIMBASE_AWS_SECRET_ACCESS_KEY", "s");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  };
}

const SUCCESS = {
  success: true,
  markdown: "# Q3 report\n\nRevenue grew.",
  type: "pdf",
  key_metadata: { credits_consumed: 1, credits_remaining: 4999 },
};

describe("isParseableMime", () => {
  it("accepts documents, code, and images", () => {
    expect(isParseableMime("application/pdf")).toBe(true);
    expect(isParseableMime("text/x-python")).toBe(true);
    expect(isParseableMime("image/png")).toBe(true);
  });

  it("rejects audio and video — Context.dev has no path for them", () => {
    expect(isParseableMime("audio/webm")).toBe(false);
    expect(isParseableMime("video/mp4")).toBe(false);
  });

  it("rejects a missing mime", () => {
    expect(isParseableMime(null)).toBe(false);
  });
});

describe("parseBytes", () => {
  it("posts raw bytes with the bearer key and mime content-type", async () => {
    fetchMock.mockResolvedValue(ok(SUCCESS));
    const data = new Uint8Array([37, 80, 68, 70]);

    const result = await parseBytes({ data, mimeType: "application/pdf" });

    expect(result).toEqual({
      markdown: "# Q3 report\n\nRevenue grew.",
      type: "pdf",
      creditsConsumed: 1,
      creditsRemaining: 4999,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.context.dev/v1/parse?");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(data);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ctxt_secret_test");
    expect(headers["Content-Type"]).toBe("application/pdf");
  });

  it("derives the extension hint from the mime and keeps links + images", async () => {
    fetchMock.mockResolvedValue(ok(SUCCESS));
    await parseBytes({
      data: new Uint8Array([1]),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const params = new URL(url).searchParams;
    // docx/xlsx/pptx are all zip containers — without the hint Parse would
    // have to guess between them.
    expect(params.get("extension")).toBe("docx");
    expect(params.get("includeLinks")).toBe("true");
    expect(params.get("includeImages")).toBe("true");
    expect(params.get("shortenBase64Images")).toBe("true");
    expect(params.get("ocr")).toBe("true");
  });

  it("lets an explicit extension override the mime-derived hint", async () => {
    fetchMock.mockResolvedValue(ok(SUCCESS));
    await parseBytes({
      data: new Uint8Array([1]),
      mimeType: "application/octet-stream",
      extension: "pptx",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get("extension")).toBe("pptx");
  });

  it("throws with the upstream status and message on an error response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 415,
      statusText: "Unsupported Media Type",
      json: () =>
        Promise.resolve({
          error: { code: "UNSUPPORTED_CONTENT", message: "cannot parse" },
        }),
    });

    await expect(
      parseBytes({
        data: new Uint8Array([1]),
        mimeType: "application/x-thing",
      }),
    ).rejects.toMatchObject({ name: "ParseError", status: 415 });
  });

  it("throws when the body is 200 but carries no markdown", async () => {
    fetchMock.mockResolvedValue(ok({ success: true, type: "pdf" }));

    await expect(
      parseBytes({ data: new Uint8Array([1]), mimeType: "application/pdf" }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("rejects oversized input before spending a request", async () => {
    const data = new Uint8Array(26 * 1024 * 1024);

    await expect(
      parseBytes({ data, mimeType: "application/pdf" }),
    ).rejects.toBeInstanceOf(ParseError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly when the API key is unset", async () => {
    vi.stubEnv("CONTEXT_DEV_API_KEY", "");
    vi.resetModules();
    const { parseBytes: fresh } = await import("./parse");

    await expect(
      fresh({ data: new Uint8Array([1]), mimeType: "application/pdf" }),
    ).rejects.toThrow(/CONTEXT_DEV_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
