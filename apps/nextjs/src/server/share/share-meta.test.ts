import { describe, expect, it } from "vitest";

import { buildShareMeta, injectShareMeta } from "./share-meta";

const base = {
  title: "Q3 KPI Breakdown",
  description: "Revenue, churn and pipeline across the three regions",
  url: "https://app.nimbase.ai/s/abc123",
};

describe("buildShareMeta", () => {
  it("emits the tags an unfurler reads", () => {
    const html = buildShareMeta(base);
    expect(html).toContain("<title>Q3 KPI Breakdown</title>");
    expect(html).toContain(
      '<meta property="og:title" content="Q3 KPI Breakdown" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://app.nimbase.ai/s/abc123" />',
    );
    expect(html).toContain(
      '<meta property="og:site_name" content="Nimbase" />',
    );
    expect(html).toContain(
      '<meta property="og:description" content="Revenue, churn and pipeline across the three regions" />',
    );
  });

  it("advertises a text-only card, since there is no image to render", () => {
    const html = buildShareMeta(base);
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html).not.toContain("og:image");
  });

  it("escapes quotes and angle brackets so a title cannot break out", () => {
    const html = buildShareMeta({
      ...base,
      title: '"><script>alert(1)</script>',
      description: null,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("omits description tags entirely when there is no description", () => {
    const html = buildShareMeta({ ...base, description: null });
    expect(html).not.toContain("og:description");
    expect(html).not.toContain('name="description"');
  });

  it("collapses whitespace and truncates a long prompt", () => {
    const html = buildShareMeta({
      ...base,
      description: `line one\n\n  line two ${"x".repeat(400)}`,
    });
    const content = /og:description" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(content.startsWith("line one line two")).toBe(true);
    expect(content.length).toBeLessThanOrEqual(200);
    expect(content.endsWith("…")).toBe(true);
  });
});

describe("injectShareMeta", () => {
  it("inserts the tags immediately after the opening head tag", () => {
    const out = injectShareMeta(
      '<!doctype html><html><head><meta charset="utf-8" /></head><body>hi</body></html>',
      base,
    );
    expect(out.indexOf("og:title")).toBeLessThan(
      out.indexOf('charset="utf-8"'),
    );
    expect(out).toContain("<body>hi</body>");
  });

  it("wins over a title the artifact authored itself", () => {
    const out = injectShareMeta(
      "<html><head><title>Untitled</title></head><body></body></html>",
      base,
    );
    // Both survive; ours is first, which is what browsers and crawlers take.
    expect(out.indexOf("<title>Q3 KPI Breakdown</title>")).toBeLessThan(
      out.indexOf("<title>Untitled</title>"),
    );
  });

  it("handles a head tag carrying attributes", () => {
    const out = injectShareMeta(
      '<html><head lang="en"><body></body></html>',
      base,
    );
    expect(out).toContain('<head lang="en">\n<title>');
  });

  it("prepends the tags when the document has no head", () => {
    const out = injectShareMeta("<h1>fragment</h1>", base);
    expect(out.indexOf("og:title")).toBeLessThan(out.indexOf("<h1>"));
  });

  it("does not treat a header element as the document head", () => {
    const out = injectShareMeta("<header>Title</header>", base);

    expect(out.indexOf("og:title")).toBeLessThan(out.indexOf("<header>"));
  });
});
