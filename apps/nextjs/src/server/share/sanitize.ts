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

// Minimal XSS guard for AI-generated share HTML: reject any <script> tag that
// isn't the allowed Tailwind CDN. SHR.1 will harden this into a real sanitizer.
export function hasUnsafeScript(html: string): boolean {
  return /<script(?![^>]*cdn\.tailwindcss\.com)/i.test(html);
}
