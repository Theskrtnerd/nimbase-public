import { describe, expect, it } from "vitest";

import { WIDGET_DEFAULT_ACCENT } from "@acme/db/schema";

import { frameAncestorsValue, widgetPanelHtml } from "./panel-html";

describe("frameAncestorsValue", () => {
  it("allows embedding on any domain when no allowlist is configured", () => {
    expect(frameAncestorsValue([])).toBe("*");
  });

  it("normalizes bare hostnames to https origins", () => {
    expect(frameAncestorsValue(["example.com"])).toBe(
      "'self' https://example.com",
    );
  });

  it("strips schemes, paths, ports, and whitespace from pasted values", () => {
    expect(frameAncestorsValue([" https://example.com/pricing "])).toBe(
      "'self' https://example.com",
    );
    expect(frameAncestorsValue(["example.com:8080"])).toBe(
      "'self' https://example.com",
    );
  });

  it("supports wildcard subdomains", () => {
    expect(frameAncestorsValue(["*.example.com"])).toBe(
      "'self' https://*.example.com",
    );
  });

  it("drops empty and junk entries and dedupes", () => {
    expect(
      frameAncestorsValue(["", "   ", "not a domain!", "a.com", "a.com"]),
    ).toBe("'self' https://a.com");
  });
});

describe("widgetPanelHtml", () => {
  const cfg = {
    name: "Acme Help",
    greeting: "Hi! Ask me anything.",
    accent: "#14707e",
    position: "right" as const,
    publicKey: "nb_wgt_abc",
    state: "active" as const,
  };

  it("escapes html in the name and greeting", () => {
    const html = widgetPanelHtml({
      ...cfg,
      name: "<script>alert(1)</script>",
      greeting: '"><img src=x>',
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("><img src=x>");
  });

  it("targets the chat endpoint for its key", () => {
    expect(widgetPanelHtml(cfg)).toContain("/api/widget/nb_wgt_abc/chat");
  });

  it("falls back to the brand accent on an invalid color", () => {
    const html = widgetPanelHtml({ ...cfg, accent: "red;}body{display:none" });
    expect(html).toContain(WIDGET_DEFAULT_ACCENT);
    expect(html).not.toContain("display:none");
  });

  it("derives the header monogram from the name, not from user markup", () => {
    expect(widgetPanelHtml({ ...cfg, name: "Acme Help" })).toContain(
      '<div class="avatar" aria-hidden="true">A</div>',
    );
    // Non-alphanumeric leading characters fall back rather than emitting them.
    expect(widgetPanelHtml({ ...cfg, name: "<b>x" })).toContain(
      '<div class="avatar" aria-hidden="true">N</div>',
    );
  });

  it("renders the unavailable state without an input form", () => {
    const html = widgetPanelHtml({ ...cfg, state: "unavailable" });
    expect(html).toContain("isn't available right now");
    expect(html).not.toContain("<form");
  });

  it("includes a subtle Nimbase attribution in every widget state", () => {
    expect(widgetPanelHtml(cfg)).toContain("Powered by Nimbase");
    expect(widgetPanelHtml({ ...cfg, state: "unavailable" })).toContain(
      "Powered by Nimbase",
    );
  });
});
