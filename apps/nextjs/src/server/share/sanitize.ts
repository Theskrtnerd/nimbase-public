import type { DefaultTreeAdapterTypes } from "parse5";
import { parseFragment } from "parse5";

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
  const document = parseFragment(html, { sourceCodeLocationInfo: true });
  return containsUnsafeScript(document, html);
}

function containsUnsafeScript(
  node: DefaultTreeAdapterTypes.Node,
  source: string,
): boolean {
  if ("tagName" in node && node.tagName === "script") {
    return !isAllowedRuntimeScript(node, source);
  }

  if ("childNodes" in node) {
    if (node.childNodes.some((child) => containsUnsafeScript(child, source))) {
      return true;
    }
  }

  // parse5 stores a template's parsed children in `content`, not childNodes.
  if (isTemplateNode(node)) {
    return containsUnsafeScript(node.content, source);
  }

  return false;
}

function isTemplateNode(
  node: DefaultTreeAdapterTypes.Node,
): node is DefaultTreeAdapterTypes.Template {
  return "tagName" in node && node.tagName === "template";
}

function isAllowedRuntimeScript(
  node: DefaultTreeAdapterTypes.Element,
  source: string,
): boolean {
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) return false;

  const startTag = source.slice(
    location.startTag.startOffset,
    location.startTag.endOffset,
  );
  const endTag = source.slice(
    location.endTag.startOffset,
    location.endTag.endOffset,
  );
  const body = source.slice(
    location.startTag.endOffset,
    location.endTag.startOffset,
  );
  const runtimeUrl = artifactRuntimeUrl("tailwind");

  return (
    (startTag === `<script src="${runtimeUrl}">` ||
      startTag === `<script src='${runtimeUrl}'>`) &&
    endTag === "</script>" &&
    body.trim().length === 0
  );
}
