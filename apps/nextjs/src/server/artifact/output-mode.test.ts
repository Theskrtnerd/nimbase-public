import { describe, expect, it } from "vitest";

import {
  attachmentFilename,
  attachmentMimeType,
  decideArtifactAttachment,
  explainRefusal,
} from "./output-mode";

const decide = (
  output: "link" | "html" | "png" | "pdf",
  visibility: "public" | "private",
  rendererAvailable = true,
) => decideArtifactAttachment({ output, visibility, rendererAvailable });

describe("decideArtifactAttachment", () => {
  it("attaches every format for a public artifact", () => {
    expect(decide("html", "public")).toEqual({ attach: true, format: "html" });
    expect(decide("png", "public")).toEqual({ attach: true, format: "png" });
    expect(decide("pdf", "public")).toEqual({ attach: true, format: "pdf" });
  });

  it("never attaches when the caller asked for a link", () => {
    expect(decide("link", "public")).toMatchObject({
      attach: false,
      refusal: "link-requested",
    });
  });

  // The fence: a file is unrevocable and unauthenticated, so it may only carry
  // what the link would already open for an anonymous chat reader.
  it("refuses to attach a private artifact in any format", () => {
    for (const output of ["html", "png", "pdf"] as const) {
      expect(decide(output, "private")).toMatchObject({
        attach: false,
        refusal: "fenced",
      });
    }
  });

  it("checks the fence before the renderer, so private never leaks a reason", () => {
    expect(decide("pdf", "private", false)).toMatchObject({
      refusal: "fenced",
    });
  });

  it("falls back to a link when png/pdf is asked for with no renderer", () => {
    expect(decide("png", "public", false)).toMatchObject({
      attach: false,
      refusal: "renderer-unavailable",
    });
    expect(decide("pdf", "public", false)).toMatchObject({
      refusal: "renderer-unavailable",
    });
  });

  it("still serves html with no renderer — it is the stored artifact", () => {
    expect(decide("html", "public", false)).toEqual({
      attach: true,
      format: "html",
    });
  });
});

describe("explainRefusal", () => {
  it("says nothing when a link was what was asked for", () => {
    expect(explainRefusal("link-requested")).toBeNull();
  });

  it("gives the model something to say for a withheld file", () => {
    expect(explainRefusal("fenced")).toContain("not public");
    expect(explainRefusal("renderer-unavailable")).toContain("link");
  });
});

describe("attachmentFilename", () => {
  it("slugifies the artifact title", () => {
    expect(attachmentFilename("Q3 KPI Breakdown", "pdf")).toBe(
      "q3-kpi-breakdown.pdf",
    );
  });

  it("strips punctuation and collapses separators", () => {
    expect(attachmentFilename("Revenue: EMEA / APAC (2026)", "png")).toBe(
      "revenue-emea-apac-2026.png",
    );
  });

  it("falls back when the title has no usable characters", () => {
    expect(attachmentFilename("!!!", "html")).toBe("artifact.html");
    expect(attachmentFilename("", "png")).toBe("artifact.png");
  });

  it("caps the length so no platform rejects the name", () => {
    const name = attachmentFilename("word ".repeat(50), "pdf");
    expect(name.length).toBeLessThanOrEqual(64);
  });
});

describe("attachmentMimeType", () => {
  it("maps each format", () => {
    expect(attachmentMimeType("html")).toBe("text/html");
    expect(attachmentMimeType("png")).toBe("image/png");
    expect(attachmentMimeType("pdf")).toBe("application/pdf");
  });
});
