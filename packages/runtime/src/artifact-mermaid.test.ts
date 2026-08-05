import { describe, expect, it } from "vitest";

import { ARTIFACT_MERMAID_HEAD, usesMermaid } from "./artifact-mermaid";

describe("usesMermaid", () => {
  it("detects the class in freeform HTML", () => {
    expect(usesMermaid(`<pre class="mermaid">graph TD; A-->B;</pre>`)).toBe(
      true,
    );
  });

  it("detects the class in React TSX", () => {
    expect(
      usesMermaid('<pre className="mermaid">{`graph TD; A-->B;`}</pre>'),
    ).toBe(true);
  });

  it("detects it alongside other classes", () => {
    expect(usesMermaid(`<div class="flex mermaid p-4">x</div>`)).toBe(true);
  });

  // The whole point of gating on the class rather than the word: mermaid is a
  // multi-megabyte bundle, and prose mentioning it must not pull it in.
  it("ignores the bare word in prose", () => {
    expect(usesMermaid("<p>We evaluated mermaid for diagrams.</p>")).toBe(
      false,
    );
  });

  it("ignores an unrelated class that merely contains the substring", () => {
    expect(usesMermaid(`<div class="mermaidish">x</div>`)).toBe(false);
  });
});

describe("ARTIFACT_MERMAID_HEAD", () => {
  it("loads through the local integrity-verifying runtime", () => {
    expect(ARTIFACT_MERMAID_HEAD).toContain(
      "nimbase-artifact-runtime.invalid/api/artifact-runtime/mermaid",
    );
    expect(ARTIFACT_MERMAID_HEAD).not.toContain("unpkg.com");
  });

  it("renders on mutation, since a fixed artifact mounts after load", () => {
    expect(ARTIFACT_MERMAID_HEAD).toContain("MutationObserver");
    expect(ARTIFACT_MERMAID_HEAD).toContain("startOnLoad: false");
  });

  it("escapes diagram labels rather than trusting model output", () => {
    expect(ARTIFACT_MERMAID_HEAD).toContain('securityLevel: "strict"');
  });

  // Our script-src has no 'unsafe-eval'; a build that needed it would fail
  // silently in the browser rather than at build time.
  it("uses no eval-family constructs", () => {
    expect(ARTIFACT_MERMAID_HEAD).not.toMatch(/\bnew Function\b|\beval\(/);
  });
});
