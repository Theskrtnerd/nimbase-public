import { describe, expect, it } from "vitest";

import { artifactRuntimeUrl } from "@acme/runtime/artifact-runtime";

import { hasUnsafeScript, stripCodeFence } from "./sanitize";

describe("stripCodeFence", () => {
  it("strips a ```html fence", () => {
    expect(stripCodeFence("```html\n<!doctype html><h1>hi</h1>\n```")).toBe(
      "<!doctype html><h1>hi</h1>",
    );
  });
  it("strips a bare ``` fence", () => {
    expect(stripCodeFence("```\n<p>x</p>\n```")).toBe("<p>x</p>");
  });
  it("leaves unfenced HTML untouched", () => {
    expect(stripCodeFence("<!doctype html><h1>hi</h1>")).toBe(
      "<!doctype html><h1>hi</h1>",
    );
  });
});

describe("hasUnsafeScript", () => {
  it("allows only the exact local Tailwind runtime script", () => {
    expect(
      hasUnsafeScript(
        `<script src="${artifactRuntimeUrl("tailwind")}"></script>`,
      ),
    ).toBe(false);
  });
  it("allows HTML with no scripts", () => {
    expect(hasUnsafeScript("<!doctype html><h1>hi</h1>")).toBe(false);
  });
  it("rejects an inline script", () => {
    expect(hasUnsafeScript("<script>alert(1)</script>")).toBe(true);
  });
  it("rejects a foreign external script", () => {
    expect(
      hasUnsafeScript('<script src="https://evil.example/x.js"></script>'),
    ).toBe(true);
  });
  it("rejects inline content on the allowed runtime tag", () => {
    expect(
      hasUnsafeScript(
        `<script src="${artifactRuntimeUrl("tailwind")}">alert(1)</script>`,
      ),
    ).toBe(true);
  });
  it("rejects an unclosed script tag", () => {
    expect(hasUnsafeScript("<script>alert(1)")).toBe(true);
  });
});
