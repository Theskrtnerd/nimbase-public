import { buildArtifactHtml } from "@acme/runtime/artifact-build";
import {
  ARTIFACT_MERMAID_HEAD,
  usesMermaid,
} from "@acme/runtime/artifact-mermaid";
import { ARTIFACT_THEME_HEAD } from "@acme/runtime/artifact-theme";

import { hasUnsafeScript } from "~/server/share/sanitize";

export type ArtifactArtifactErrorCode = "transpile_failed" | "unsafe_output";

/**
 * A build failure the model can plausibly fix by rewriting its output — a TSX
 * syntax error, or a freeform document that smuggled in a <script> tag. Carries
 * the code separately so the repair prompt can explain the failure in the
 * model's own terms while `message` stays the string we persist to Artifact.error.
 */
export class ArtifactArtifactError extends Error {
  constructor(
    readonly code: ArtifactArtifactErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "ArtifactArtifactError";
  }
}

export interface BuiltArtifact {
  html: string;
  /** The TSX we transpiled ("fixed" only) — stored alongside the HTML. */
  source: string | null;
}

/**
 * Turn a raw model artifact into the HTML we upload. Pure: no AI, no I/O — so
 * the repair loop can call it once per attempt and unit tests can drive every
 * failure mode directly.
 */
export function buildArtifactArtifact(
  raw: string,
  opts: { kind: "fixed" | "freeform"; useAppTheme: boolean },
): BuiltArtifact {
  if (opts.kind === "fixed") {
    let html: string;
    try {
      html = buildArtifactHtml(raw, {
        theme: opts.useAppTheme ? "app" : "custom",
      });
    } catch (err) {
      throw new ArtifactArtifactError(
        "transpile_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    return { html, source: raw };
  }

  let html = raw;
  if (hasUnsafeScript(html)) {
    throw new ArtifactArtifactError(
      "unsafe_output",
      "generated HTML contains blocked script patterns",
    );
  }
  if (opts.useAppTheme) {
    html = injectAppTheme(html);
  }
  // After the sanitizer, deliberately: the model is never allowed to write
  // a <script> tag itself, so mermaid is spliced in server-side once the
  // output has been checked. Keeps hasUnsafeScript strict.
  if (usesMermaid(html)) {
    html = injectMermaid(html);
  }
  return { html, source: null };
}

/**
 * The follow-up turn we send after a failed build. The model never sees its own
 * artifact again in the conversation (each artifact turn is a fresh generateText),
 * so the broken source is quoted back in full — otherwise "fix line 455" is
 * meaningless to it.
 *
 * Truncation is called out separately because the fix is different in kind: the
 * source isn't wrong, there just isn't all of it, and telling the model to
 * "correct the syntax error" would have it patch the seam and hit the ceiling
 * again.
 */
export function artifactRepairPrompt(opts: {
  kind: "fixed" | "freeform";
  source: string;
  error: ArtifactArtifactError;
  truncated: boolean;
}): string {
  const artifact = opts.kind === "fixed" ? "TSX component" : "HTML document";
  const cause =
    opts.error.code === "unsafe_output"
      ? `The document contains a blocked <script> tag. Keep only the exact local Tailwind runtime tag from the output rules, and drop any behaviour that depended on other scripts — render the result statically instead.`
      : `The ${artifact} failed to parse:\n\n${opts.error.detail}\n\nThe location is reported as (line:column) into the source below.`;
  const truncationNote = opts.truncated
    ? `\n\nYour previous output was cut off at the output-token limit — the file is incomplete, which is the likely cause. Produce a SHORTER artifact that fits: fewer inline data rows, fewer sections, no repeated boilerplate. Completeness matters more than richness.`
    : "";

  return `Your previous attempt could not be built.

${cause}${truncationNote}

Output the COMPLETE corrected ${artifact} — the whole file from the first line to the last, not a diff, patch, or excerpt. Same rules as before: no markdown fences, no prose, no commentary.

Previous attempt:
${opts.source}`;
}

// Splice the mermaid loader into freeform HTML. Same placement logic as the
// theme, minus the Tailwind ordering constraint — mermaid depends on nothing.
function injectMermaid(html: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${ARTIFACT_MERMAID_HEAD}\n</head>`);
  }
  return `${ARTIFACT_MERMAID_HEAD}\n${html}`;
}

// Splice the app design tokens into freeform HTML. Prefer placing it right
// after the Tailwind runtime <script> so `tailwind.config` is read once the Play
// runtime has loaded; otherwise fall back to just before </head>.
function injectAppTheme(html: string): string {
  const runtimeTag =
    /<script[^>]*nimbase-artifact-runtime\.invalid\/api\/artifact-runtime\/tailwind[^>]*>\s*<\/script>/i;
  if (runtimeTag.test(html)) {
    return html.replace(runtimeTag, (tag) => `${tag}\n${ARTIFACT_THEME_HEAD}`);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${ARTIFACT_THEME_HEAD}\n</head>`);
  }
  return html;
}
