import { describe, expect, it } from "vitest";

import { serveShareHtml } from "./serve-share-html";

describe("serveShareHtml", () => {
  const res = serveShareHtml("<!doctype html><h1>hi</h1>");

  it("serves the HTML body with the html content type", async () => {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<!doctype html><h1>hi</h1>");
  });

  it("sandboxes the document into an opaque origin", () => {
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain(
      "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
    );
    // No allow-same-origin: cookies/localStorage/same-origin fetch stay off.
    expect(csp).not.toContain("allow-same-origin");
  });

  it("restricts scripts to the artifact CDNs and blocks network/embedding", () => {
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain(
      "script-src 'unsafe-inline' https://unpkg.com https://cdn.tailwindcss.com",
    );
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("suppresses the referrer", () => {
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("prevents public artifact links from being indexed", () => {
    expect(res.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
  });

  it("splices in unfurl metadata when meta is supplied", async () => {
    const withMeta = serveShareHtml(
      "<html><head></head><body>hi</body></html>",
      {
        title: "Q3 KPI Breakdown",
        description: "Revenue and churn",
        url: "https://app.nimbase.ai/s/abc",
      },
    );
    const body = await withMeta.text();
    expect(body).toContain(
      '<meta property="og:title" content="Q3 KPI Breakdown" />',
    );
    expect(body).toContain("<body>hi</body>");
  });
});
