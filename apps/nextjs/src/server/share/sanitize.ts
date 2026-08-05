import { artifactRuntimeUrl } from "@acme/runtime/artifact-runtime";

// Claude sometimes wraps the document in a ```html ... ``` markdown fence despite
// being told not to. Strip a leading/trailing fence so we store clean HTML.
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return text;
  return trimmed
    .replace(/^```[a-zA-Z]*\n/, "")
    .replace(/\n?```$/, "")
    .trim();
}

// AI-generated freeform HTML may load only the fixed local Tailwind runtime.
// Inline bodies, extra attributes, malformed tags, and every other script URL
// fail closed. The served document is additionally protected by an
// opaque-origin sandbox and a network-denying CSP.
export function hasUnsafeScript(html: string): boolean {
  const openTags = html.match(/<script\b/gi)?.length ?? 0;
  const scriptTags = html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
  if (scriptTags.length !== openTags) return openTags > 0;

  const allowedSource = artifactRuntimeUrl("tailwind").replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const allowed = new RegExp(
    `^<script\\s+src=(?:"${allowedSource}"|'${allowedSource}')\\s*>\\s*<\\/script\\s*>$`,
    "i",
  );
  return scriptTags.some((tag) => !allowed.test(tag));
}
