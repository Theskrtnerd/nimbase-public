import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ArtifactArtifactError,
  artifactRepairPrompt,
  buildArtifactArtifact,
} from "./build-artifact";

const mocks = vi.hoisted(() => ({
  buildArtifactHtml: vi.fn(),
  hasUnsafeScript: vi.fn(),
}));

// Same seams as generate.test.ts: there is no "~" alias under vitest, and the
// real transpiler is covered canonically in packages/runtime/src/artifact-build.test.ts.
// What's under test here is the wiring — which failures become a repairable
// ArtifactArtifactError, and what the model is told about them.
vi.mock("@acme/runtime/artifact-build", () => ({
  buildArtifactHtml: mocks.buildArtifactHtml,
}));
vi.mock("@acme/runtime/artifact-theme", () => ({
  ARTIFACT_THEME_HEAD: "<style>/* theme */</style>",
}));
vi.mock("@acme/runtime/artifact-mermaid", () => ({
  ARTIFACT_MERMAID_HEAD: "<script>/* mermaid */</script>",
  usesMermaid: (s: string) =>
    /class(?:Name)?\s*=\s*["'`][^"'`]*\bmermaid\b/.test(s),
}));
vi.mock("~/server/share/sanitize", () => ({
  hasUnsafeScript: mocks.hasUnsafeScript,
  stripCodeFence: (s: string) => s,
}));

// The real-world failure: the model hit its output ceiling mid-expression.
const TRUNCATED_TSX = `export default function C() {\n  return (\n    <div>\n      {rows.map((r) => (\n        <span>{r.`;

describe("buildArtifactArtifact — fixed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transpiles a valid component and keeps the source", () => {
    mocks.buildArtifactHtml.mockReturnValue("<!doctype html>built");

    const built = buildArtifactArtifact("export default () => <div />;", {
      kind: "fixed",
      useAppTheme: true,
    });

    expect(mocks.buildArtifactHtml).toHaveBeenCalledWith(
      "export default () => <div />;",
      { theme: "app" },
    );
    expect(built.source).toBe("export default () => <div />;");
    expect(built.html).toBe("<!doctype html>built");
  });

  it("passes the custom theme through", () => {
    mocks.buildArtifactHtml.mockReturnValue("x");
    buildArtifactArtifact("x", { kind: "fixed", useAppTheme: false });
    expect(mocks.buildArtifactHtml).toHaveBeenCalledWith("x", {
      theme: "custom",
    });
  });

  it("wraps a parse failure as a repairable transpile_failed error", () => {
    mocks.buildArtifactHtml.mockImplementation(() => {
      throw new Error("Unexpected token (455:12)");
    });

    try {
      buildArtifactArtifact(TRUNCATED_TSX, {
        kind: "fixed",
        useAppTheme: true,
      });
      expect.unreachable("expected a build failure");
    } catch (err) {
      expect(err).toBeInstanceOf(ArtifactArtifactError);
      expect((err as ArtifactArtifactError).code).toBe("transpile_failed");
      // The persisted message keeps the historical "code: detail" shape.
      expect((err as ArtifactArtifactError).message).toBe(
        "transpile_failed: Unexpected token (455:12)",
      );
    }
  });
});

describe("buildArtifactArtifact — freeform", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a smuggled script tag as a repairable error", () => {
    mocks.hasUnsafeScript.mockReturnValue(true);
    try {
      buildArtifactArtifact("<script>alert(1)</script>", {
        kind: "freeform",
        useAppTheme: false,
      });
      expect.unreachable("expected a build failure");
    } catch (err) {
      expect(err).toBeInstanceOf(ArtifactArtifactError);
      expect((err as ArtifactArtifactError).code).toBe("unsafe_output");
    }
  });

  it("injects the app theme after the local Tailwind runtime tag", () => {
    mocks.hasUnsafeScript.mockReturnValue(false);
    const { html, source } = buildArtifactArtifact(
      '<html><head><script src="https://nimbase-artifact-runtime.invalid/api/artifact-runtime/tailwind"></script></head><body>x</body></html>',
      { kind: "freeform", useAppTheme: true },
    );
    expect(source).toBeNull();
    expect(html.indexOf("/* theme */")).toBeGreaterThan(
      html.indexOf("nimbase-artifact-runtime.invalid"),
    );
  });

  it("injects the mermaid loader only when a diagram is present", () => {
    mocks.hasUnsafeScript.mockReturnValue(false);
    const withDiagram = buildArtifactArtifact(
      '<html><head></head><body><pre class="mermaid">graph TD; A --> B;</pre></body></html>',
      { kind: "freeform", useAppTheme: false },
    );
    expect(withDiagram.html).toContain("/* mermaid */");

    const without = buildArtifactArtifact(
      "<html><head></head><body>x</body></html>",
      {
        kind: "freeform",
        useAppTheme: false,
      },
    );
    expect(without.html).not.toContain("/* mermaid */");
  });
});

describe("artifactRepairPrompt", () => {
  const error = new ArtifactArtifactError(
    "transpile_failed",
    "Unexpected token (455:12)",
  );

  it("quotes the compiler error and the full previous source", () => {
    const prompt = artifactRepairPrompt({
      kind: "fixed",
      source: TRUNCATED_TSX,
      error,
      truncated: false,
    });
    // The (line:column) is meaningless without the source it indexes into.
    expect(prompt).toContain("Unexpected token (455:12)");
    expect(prompt).toContain(TRUNCATED_TSX);
    expect(prompt).toContain("COMPLETE corrected");
  });

  it("tells a truncated attempt to shorten rather than patch the seam", () => {
    const prompt = artifactRepairPrompt({
      kind: "fixed",
      source: TRUNCATED_TSX,
      error,
      truncated: true,
    });
    expect(prompt).toContain("cut off at the output-token limit");
    expect(prompt).toContain("SHORTER");
  });

  it("explains an unsafe_output failure in terms of its own fix", () => {
    const prompt = artifactRepairPrompt({
      kind: "freeform",
      source: "<script>x</script>",
      error: new ArtifactArtifactError("unsafe_output", "blocked script"),
      truncated: false,
    });
    expect(prompt).toContain("<script> tag");
    expect(prompt).not.toContain("failed to parse");
  });
});
