// biographer.test.ts — the pure parts: HTML stripping and the deterministic
// fallback template (the AI path is fail-soft onto it).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPANY_MD_PATH,
  companyMdFallback,
  draftCompanyMd,
  enrichCompanyWebsite,
  stripHtml,
} from "./biographer";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  readResponseText: vi.fn(),
}));

vi.mock("./ai");
vi.mock("ai");
vi.mock("./safe-http", () => ({
  safeFetch: mocks.safeFetch,
  readResponseText: mocks.readResponseText,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("COMPANY_MD_PATH", () => {
  it("is the lowercase kebab root path the VFS accepts", () => {
    expect(COMPANY_MD_PATH).toBe("company.md");
  });
});

describe("stripHtml", () => {
  it("drops scripts, styles, tags, and entities; collapses whitespace", () => {
    const html = `<html><head><style>.x{color:red}</style>
      <script>alert("evil")</script></head>
      <body><h1>Acme&nbsp;Corp</h1><p>We   build <b>rockets</b>.</p></body></html>`;
    expect(stripHtml(html)).toBe("Acme Corp We build rockets .");
  });

  it("caps very long documents", () => {
    const html = `<p>${"a".repeat(20_000)}</p>`;
    expect(stripHtml(html).length).toBeLessThanOrEqual(8_000);
  });
});

describe("enrichCompanyWebsite", () => {
  it("returns safely fetched site text without managed brand enrichment", async () => {
    mocks.safeFetch.mockResolvedValue(
      new Response("<h1>Acme</h1>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    mocks.readResponseText.mockResolvedValue("<h1>Acme</h1>");

    await expect(enrichCompanyWebsite("https://acme.example")).resolves.toEqual(
      {
        title: null,
        description: null,
        logoUrl: null,
        siteText: "Acme",
      },
    );
  });
});

describe("companyMdFallback", () => {
  it("uses the description and links the website", () => {
    const md = companyMdFallback({
      name: "Acme",
      description: "We build rockets.",
      websiteUrl: "https://acme.dev",
    });
    expect(md).toContain("# Acme");
    expect(md).toContain("We build rockets. ([website](https://acme.dev))");
    expect(md).toContain("## How this memory is organized");
  });

  it("stays neutral when only the name is known", () => {
    const md = companyMdFallback({ name: "Acme" });
    expect(md).toContain("# Acme");
    expect(md).toContain("fill me in");
    expect(md).not.toContain("website");
  });
});

describe("draftCompanyMd", () => {
  it("uses pre-fetched siteText instead of fetching", async () => {
    const md = await draftCompanyMd({
      workspaceId: "ws-1",
      name: "Acme",
      description: null,
      websiteUrl: "https://acme.test",
      siteText: "Acme builds anvils.",
    });
    expect(mocks.safeFetch).not.toHaveBeenCalled();
    expect(md.length).toBeGreaterThan(0);
  });
});
