import type { ArtifactVisibility } from "@acme/db/schema";

/**
 * How a finished artifact is delivered into a chat turn.
 *
 * This is a *delivery* concern, not a generation one: the pipeline still
 * produces exactly one artifact (the stored S3 HTML), and every mode below is
 * a rendering of that same artifact. Nothing here belongs in `Artifact.kind`.
 *
 * - `link` — the `/s/<slug>` URL. The default, and the only mode whose
 *   exposure stays governed by `Artifact.visibility` after delivery.
 * - `html` — the stored artifact as a file. No rendering needed.
 * - `png` / `pdf` — the artifact run through a headless browser.
 */
export type ArtifactOutput = "link" | "html" | "png" | "pdf";

export const ARTIFACT_OUTPUTS: ArtifactOutput[] = [
  "link",
  "html",
  "png",
  "pdf",
];

/** A rendered form of the artifact. `html` is the artifact itself. */
export type AttachmentFormat = "html" | "png" | "pdf";

export type AttachmentRefusal =
  /** Caller asked for a plain link — nothing to attach. */
  | "link-requested"
  /** The artifact is not link-readable by this reader; see below. */
  | "fenced"
  /** png/pdf asked for but no renderer is configured. */
  | "renderer-unavailable";

export type AttachmentDecision =
  | { attach: true; format: AttachmentFormat }
  | { attach: false; format: null; refusal: AttachmentRefusal };

/**
 * Decide whether a artifact may be delivered as a file rather than a link.
 *
 * The rule that matters: **a file may never carry content the link would not.**
 * A `/s/<slug>` link stays governed by `Artifact.visibility` for its whole life —
 * a private artifact 404s, and either link can be revoked later. A file posted
 * into a channel is none of those things: it is
 * readable by everyone in that channel, forever, with no revocation path. So
 * attachment is allowed only where the link itself would already open for an
 * anonymous chat reader, which is exactly `visibility === "public"`.
 */
export function decideArtifactAttachment(input: {
  output: ArtifactOutput;
  visibility: ArtifactVisibility;
  rendererAvailable: boolean;
}): AttachmentDecision {
  if (input.output === "link") {
    return { attach: false, format: null, refusal: "link-requested" };
  }
  if (input.visibility !== "public") {
    return { attach: false, format: null, refusal: "fenced" };
  }
  if (input.output !== "html" && !input.rendererAvailable) {
    return { attach: false, format: null, refusal: "renderer-unavailable" };
  }
  return { attach: true, format: input.output };
}

/**
 * What to tell the model when a requested attachment was withheld, so it can
 * explain rather than silently posting a bare link the user did not ask for.
 */
export function explainRefusal(refusal: AttachmentRefusal): string | null {
  switch (refusal) {
    case "link-requested":
      return null;
    case "fenced":
      return "A file was requested, but this artifact is not public, so it can only be shared as a link that checks the reader's access. Say so, and share the link.";
    case "renderer-unavailable":
      return "A rendered file was requested, but no renderer is configured. Share the link instead and say the file was not available.";
  }
}

const EXTENSION: Record<AttachmentFormat, string> = {
  html: "html",
  png: "png",
  pdf: "pdf",
};

const MIME: Record<AttachmentFormat, string> = {
  html: "text/html",
  png: "image/png",
  pdf: "application/pdf",
};

export function attachmentMimeType(format: AttachmentFormat): string {
  return MIME[format];
}

/** A filesystem-safe download name derived from the artifact title. */
export function attachmentFilename(
  title: string,
  format: AttachmentFormat,
): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact";
  return `${slug}.${EXTENSION[format]}`;
}
