import { describe, expect, it } from "vitest";

import { docSiteBasePath, docSiteUrl } from "./doc-site-url";

describe("docSiteBasePath", () => {
  it("is the path a site is served under", () => {
    expect(docSiteBasePath("acme", "customer-docs")).toBe(
      "/acme/customer-docs",
    );
  });

  it("matches the Astro base the runner bakes in", () => {
    // These must agree: the build hardcodes this prefix into every asset and
    // nav link, so a serving path that differs breaks the whole site.
    const path = docSiteBasePath("big-corp", "api-reference");
    expect(`${path}/`).toBe("/big-corp/api-reference/");
  });
});

describe("docSiteUrl", () => {
  it("builds the production address from the docs host", () => {
    expect(
      docSiteUrl({
        workspaceSlug: "acme",
        siteSlug: "customer-docs",
        docsHost: "docs.nimbase.ai",
      }),
    ).toBe("https://docs.nimbase.ai/acme/customer-docs");
  });

  it("falls back to the route in dev, where no docs host exists", () => {
    expect(
      docSiteUrl({
        workspaceSlug: "acme",
        siteSlug: "customer-docs",
        devOrigin: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000/api/docs-site/acme/customer-docs");
  });

  it("agrees with the base path the build is compiled against", () => {
    // The single fact three implementations used to disagree about.
    const url = docSiteUrl({
      workspaceSlug: "a",
      siteSlug: "b",
      docsHost: "docs.example.com",
    });
    expect(url.endsWith(docSiteBasePath("a", "b"))).toBe(true);
  });
});
