import { describe, expect, it } from "vitest";

import { buildRawMd } from "./raw-md";

describe("buildRawMd", () => {
  it("builds frontmatter from the known scalar fields plus the body", () => {
    const md = buildRawMd({
      kind: "web",
      title: "A page",
      body: "# Hello\n\nWorld",
      originalFilename: "page.md",
      mimeType: "text/markdown",
      sizeBytes: 42,
      contentHash: "abc123",
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(md).toBe(
      [
        "---",
        'kind: "web"',
        'title: "A page"',
        'originalFilename: "page.md"',
        'mimeType: "text/markdown"',
        "sizeBytes: 42",
        'contentHash: "abc123"',
        'capturedAt: "2026-01-01T00:00:00.000Z"',
        "---",
        "",
        "# Hello\n\nWorld",
      ].join("\n"),
    );
  });

  it("omits null, undefined, and empty-string fields entirely", () => {
    const md = buildRawMd({
      kind: "highlight",
      title: null,
      body: "snip",
      originalFilename: undefined,
      mimeType: "",
      sizeBytes: null,
    });
    expect(md).toBe('---\nkind: "highlight"\n---\n\nsnip');
  });

  it("flattens scalar metadata fields into frontmatter", () => {
    const md = buildRawMd({
      kind: "chat_export",
      title: "A chat",
      body: "conversation",
      metadata: {
        provider: "claude",
        messageCount: 12,
        captureQuality: "provider-parser",
        tags: ["work", "research"],
      },
    });
    expect(md).toContain('provider: "claude"');
    expect(md).toContain("messageCount: 12");
    expect(md).toContain('captureQuality: "provider-parser"');
    expect(md).toContain('tags: ["work","research"]');
  });

  it("appends meta tags, schema.org data, and full HTML as trailing sections, not frontmatter", () => {
    const md = buildRawMd({
      kind: "web",
      title: "A page",
      body: "article text",
      metadata: {
        metaTags: [
          { name: "description", content: "a page" },
          { property: "og:title", content: null },
          { content: "no name or property" },
        ],
        schemaOrgData: { "@type": "Article", headline: "Hi" },
        fullHtml: "<html><body>hi</body></html>",
      },
    });

    expect(md).not.toContain("metaTags:");
    expect(md).not.toContain("schemaOrgData:");
    expect(md).not.toContain("fullHtml:");

    expect(md).toContain("## Meta Tags");
    expect(md).toContain("- description: a page");
    expect(md).toContain("- og:title: ");
    expect(md).toContain("- : no name or property");

    expect(md).toContain("## Schema.org Data");
    expect(md).toContain('"headline": "Hi"');

    expect(md).toContain("## Full Page HTML");
    expect(md).toContain("<html><body>hi</body></html>");

    // sections come after the body, in a fixed order
    const bodyIndex = md.indexOf("article text");
    const metaIndex = md.indexOf("## Meta Tags");
    const schemaIndex = md.indexOf("## Schema.org Data");
    const htmlIndex = md.indexOf("## Full Page HTML");
    expect(bodyIndex).toBeLessThan(metaIndex);
    expect(metaIndex).toBeLessThan(schemaIndex);
    expect(schemaIndex).toBeLessThan(htmlIndex);
  });

  it("omits empty trailing sections", () => {
    const md = buildRawMd({
      kind: "web",
      title: "A page",
      body: "text",
      metadata: { metaTags: [], fullHtml: "" },
    });
    expect(md).toBe('---\nkind: "web"\ntitle: "A page"\n---\n\ntext');
  });
});
