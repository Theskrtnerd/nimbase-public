import { describe, expect, it } from "vitest";

import { buildArtifactHtml } from "./artifact-build";

describe("buildArtifactHtml", () => {
  it("wraps a default-export component into a self-contained doc", () => {
    const tsx = `export default function Hello() {
  return <div className="p-4">hi</div>;
}`;
    const html = buildArtifactHtml(tsx);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("cdn.tailwindcss.com");
    expect(html).toContain("React.createElement");
    expect(html).toContain('"hi"');
  });

  it("strips a leading TSX type annotation without throwing", () => {
    const tsx = `import { useState } from "react";
export default function Counter() {
  const [n, setN] = useState<number>(0);
  return <button onClick={() => setN((p) => p + 1)}>{n}</button>;
}`;
    const html = buildArtifactHtml(tsx);
    expect(html).toContain("createRoot");
  });

  it("throws on malformed TSX", () => {
    expect(() => buildArtifactHtml("export default function (")).toThrow();
  });

  it("omits the mermaid bundle when no diagram is used", () => {
    const html = buildArtifactHtml(
      `export default function X() { return <div>hi</div>; }`,
    );
    expect(html).not.toContain("mermaid");
  });

  it("loads mermaid only when the component renders a diagram", () => {
    const tsx = `export default function X() {
  return <pre className="mermaid">{\`graph TD; A --> B;\`}</pre>;
}`;
    const html = buildArtifactHtml(tsx);
    expect(html).toContain("https://unpkg.com/mermaid@11");
    expect(html).toContain("MutationObserver");
  });

  it("escapes a </script> sequence in the component source", () => {
    const tsx = `export default function X() {
  return <div data-x={"</script>"}>hi</div>;
}`;
    const html = buildArtifactHtml(tsx);
    // The raw closing-tag sequence must not appear inside the inlined script.
    expect(html).toContain("<\\/script>");
  });
});
