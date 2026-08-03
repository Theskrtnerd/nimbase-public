import "server-only";

const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOTE_LEAF_RE = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;

// Every path segment must be kebab-case: lowercase letters/digits,
// hyphen-separated — no spaces, underscores, or uppercase. Applies to both
// note and folder-prefix segments. Returns an error message, or null if
// every segment is valid.
export function kebabSegmentError(path: string): string | null {
  for (const seg of path.split("/").filter(Boolean)) {
    if (!SEGMENT_RE.test(seg)) {
      return `"${seg}" isn't kebab-case — use lowercase letters/digits separated by hyphens (e.g. "compile-pipeline")`;
    }
  }
  return null;
}

// A note's leaf (file) segment must be kebab-case and end in ".md". Returns
// an error message, or null if valid.
export function noteLeafError(path: string): string | null {
  const leaf = path.split("/").filter(Boolean).at(-1) ?? path;
  if (!NOTE_LEAF_RE.test(leaf)) {
    return `"${leaf}" must be kebab-case and end in .md, e.g. "compile-pipeline.md"`;
  }
  return null;
}
