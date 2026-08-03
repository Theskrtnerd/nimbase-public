import { describe, expect, it } from "vitest";

import type { DocPage, MemoryPage } from "./project";
import {
  contentPathFor,
  projectDocsContent,
  renderDocPage,
  serializeFrontmatter,
  titleizeSegment,
  yamlString,
} from "./project";

function page(path: string, body: string, title = "Untitled"): MemoryPage {
  return { path, title, body };
}

const OPTS = { fencePrefix: "teams/acme", siteTitle: "Acme Docs" };

/** Render a projected page so assertions can read its final markdown. */
function fileAt(pages: DocPage[], path: string) {
  const page = pages.find((p) => p.path === path);
  return page ? renderDocPage(page) : undefined;
}

describe("contentPathFor", () => {
  it("strips the fence prefix", () => {
    expect(contentPathFor("teams/acme/product/pricing.md", "teams/acme")).toBe(
      "product/pricing.md",
    );
  });

  it("maps company.md to the site index", () => {
    expect(contentPathFor("teams/acme/company.md", "teams/acme")).toBe(
      "index.md",
    );
  });

  it("drops pages outside the fence", () => {
    expect(contentPathFor("teams/other/secret.md", "teams/acme")).toBeNull();
    // A prefix that only matches as a string, not as a path segment.
    expect(contentPathFor("teams/acme-corp/x.md", "teams/acme")).toBeNull();
  });

  it("drops the fence folder itself", () => {
    expect(contentPathFor("teams/acme", "teams/acme")).toBeNull();
  });

  it("rejects traversal and absolute paths", () => {
    expect(
      contentPathFor("teams/acme/../../etc/passwd.md", "teams/acme"),
    ).toBeNull();
    expect(contentPathFor("teams/acme//x.md", "teams/acme")).toBeNull();
  });

  it("handles an empty fence prefix (whole workspace)", () => {
    expect(contentPathFor("product/pricing.md", "")).toBe("product/pricing.md");
  });
});

describe("serializeFrontmatter", () => {
  it("quotes and escapes titles", () => {
    const out = serializeFrontmatter({ title: 'The "big" release' });
    expect(out).toContain('title: "The \\"big\\" release"');
  });

  it("collapses multi-line titles to one line", () => {
    expect(serializeFrontmatter({ title: "a\n\nb" })).toContain('title: "a b"');
  });

  it("omits description when absent", () => {
    expect(serializeFrontmatter({ title: "x" })).not.toContain("description");
  });

  it("nests sidebar keys", () => {
    const out = serializeFrontmatter({
      title: "x",
      sidebarOrder: 3,
      sidebarLabel: "X",
    });
    expect(out).toContain('sidebar:\n  label: "X"\n  order: 3');
  });
});

describe("yamlString", () => {
  it("escapes backslashes before quotes", () => {
    expect(yamlString('a\\"b')).toBe('"a\\\\\\"b"');
  });
});

describe("titleizeSegment", () => {
  it("sentence-cases a kebab segment", () => {
    expect(titleizeSegment("getting-started")).toBe("Getting started");
  });
});

describe("projectDocsContent", () => {
  it("emits .md, never .mdx, so markdown cannot break an MDX parse", () => {
    const { pages } = projectDocsContent(
      [
        page(
          "teams/acme/a.md",
          "---\ntype: Note\ntitle: A\n---\nUse <Foo> and {bar}.",
        ),
      ],
      OPTS,
    );
    expect(pages.every((p) => p.path.endsWith(".md"))).toBe(true);
    expect(fileAt(pages, "a.md")?.contents).toContain("Use <Foo> and {bar}.");
  });

  it("drops OKF keys that strict docsSchema would reject", () => {
    const { pages } = projectDocsContent(
      [
        page(
          "teams/acme/a.md",
          "---\ntype: Note\ntitle: A\ntags: [x]\ntimestamp: 2026-01-01\nsources:\n  - nimbase://source/abc\n---\nBody",
        ),
      ],
      OPTS,
    );
    const contents = fileAt(pages, "a.md")?.contents ?? "";
    expect(contents).toContain('title: "A"');
    expect(contents).not.toContain("type:");
    expect(contents).not.toContain("tags:");
    expect(contents).not.toContain("timestamp:");
  });

  it("never leaks source provenance into customer-facing output", () => {
    const { pages } = projectDocsContent(
      [
        page(
          "teams/acme/a.md",
          "---\ntype: Note\ntitle: A\nsources:\n  - nimbase://source/1111\n---\nBody",
        ),
      ],
      OPTS,
    );
    for (const page of pages.map(renderDocPage)) {
      expect(page.contents).not.toContain("nimbase://");
    }
  });

  it("prefers the OKF title over the index title", () => {
    const { pages } = projectDocsContent(
      [
        page(
          "teams/acme/a.md",
          "---\ntype: Note\ntitle: From OKF\n---\nB",
          "From index",
        ),
      ],
      OPTS,
    );
    expect(fileAt(pages, "a.md")?.contents).toContain('title: "From OKF"');
  });

  it("falls back to the index title when frontmatter has none", () => {
    const { pages } = projectDocsContent(
      [page("teams/acme/a.md", "---\ntype: Note\n---\nB", "From index")],
      OPTS,
    );
    expect(fileAt(pages, "a.md")?.contents).toContain('title: "From index"');
  });

  it("skips a page with no title at all rather than failing the build", () => {
    const result = projectDocsContent(
      [page("teams/acme/a.md", "---\ntype: Note\n---\nB", "")],
      OPTS,
    );
    expect(fileAt(result.pages, "a.md")).toBeUndefined();
    expect(result.skipped).toEqual([
      { path: "teams/acme/a.md", reason: "no title" },
    ]);
  });

  it("synthesizes an index for every directory and the root", () => {
    const { pages } = projectDocsContent(
      [
        page(
          "teams/acme/product/deep/pricing.md",
          "---\ntype: Note\ntitle: P\n---\nB",
        ),
      ],
      OPTS,
    );
    expect(fileAt(pages, "index.md")?.contents).toContain('title: "Acme Docs"');
    expect(fileAt(pages, "product/index.md")?.contents).toContain(
      'title: "Product"',
    );
    expect(fileAt(pages, "product/deep/index.md")).toBeDefined();
  });

  it("does not overwrite an authored index", () => {
    const { pages } = projectDocsContent(
      [
        page(
          "teams/acme/company.md",
          "---\ntype: Note\ntitle: Acme Inc\n---\nWe make things.",
        ),
      ],
      OPTS,
    );
    expect(fileAt(pages, "index.md")?.contents).toContain('title: "Acme Inc"');
    expect(fileAt(pages, "index.md")?.contents).toContain("We make things.");
  });

  it("counts only real pages, not synthesized indexes", () => {
    const result = projectDocsContent(
      [
        page("teams/acme/product/a.md", "---\ntype: Note\ntitle: A\n---\nB"),
        page("teams/acme/product/b.md", "---\ntype: Note\ntitle: B\n---\nB"),
      ],
      OPTS,
    );
    expect(result.pageCount).toBe(2);
    expect(result.pages.length).toBe(4); // 2 pages + root index + product index
  });

  it("records out-of-fence pages as skipped instead of emitting them", () => {
    const result = projectDocsContent(
      [page("teams/other/secret.md", "---\ntype: Note\ntitle: S\n---\nB")],
      OPTS,
    );
    expect(result.pageCount).toBe(0);
    expect(result.skipped[0]?.reason).toBe("outside fence or unsafe path");
    expect(result.pages.map((p) => p.path)).toEqual(["index.md"]);
  });

  it("reports a collision rather than silently dropping a page", () => {
    const result = projectDocsContent(
      [
        page("teams/acme/index.md", "---\ntype: Note\ntitle: Authored\n---\nA"),
        page(
          "teams/acme/company.md",
          "---\ntype: Note\ntitle: Company\n---\nC",
        ),
      ],
      OPTS,
    );
    expect(fileAt(result.pages, "index.md")?.contents).toContain("Authored");
    expect(result.skipped).toEqual([
      { path: "teams/acme/company.md", reason: "collides with index.md" },
    ]);
  });

  it("is deterministic and order-independent in output", () => {
    const pages = [
      page("teams/acme/b.md", "---\ntype: Note\ntitle: B\n---\nB"),
      page("teams/acme/a.md", "---\ntype: Note\ntitle: A\n---\nA"),
    ];
    const first = projectDocsContent(pages, OPTS);
    const second = projectDocsContent([...pages].reverse(), OPTS);
    expect(first.pages).toEqual(second.pages);
  });
});

describe("renderDocPage", () => {
  // Regression: the pipeline used to hand curation serialized markdown, which
  // then regexed the title back out with /^title:\s*"(.*)"$/ — a pattern that
  // cannot see yamlString's escaping. A title with a quote came back carrying
  // its backslashes and got re-escaped on every republish. Carrying DocPage
  // through instead means there is nothing to re-parse.
  it("survives a title containing quotes and backslashes", () => {
    const page = {
      path: "a.md",
      title: 'Pricing & "plans" \\ more',
      body: "Body",
    };
    const rendered = renderDocPage(page);
    expect(rendered.contents).toContain(
      'title: "Pricing & \\"plans\\" \\\\ more"',
    );
    // Rendering is idempotent on the model: the page is unchanged by it.
    expect(renderDocPage(page)).toEqual(rendered);
  });

  it("renders a synthesized index as frontmatter with an empty body", () => {
    const rendered = renderDocPage({ path: "index.md", title: "X", body: "" });
    expect(rendered.contents).toBe('---\ntitle: "X"\n---\n\n');
  });

  it("emits sidebar order when curation assigned one", () => {
    const rendered = renderDocPage({
      path: "a.md",
      title: "A",
      body: "B",
      sidebarOrder: 3,
    });
    expect(rendered.contents).toContain("sidebar:\n  order: 3");
  });
});
