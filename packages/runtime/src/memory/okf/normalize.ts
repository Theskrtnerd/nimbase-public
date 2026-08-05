// Pure title/tag normalization shared by the OKF codec and the wiki VFS
// helpers. Deliberately free of "server-only" so the codec stays importable
// from scripts and non-server test contexts (e.g. the api package's
// knowledge-graph tests).

const MAX_TITLE_LENGTH = 120;
const MAX_TAGS = 12;

// Trim + collapse whitespace + cap length. Returns null if the result is
// empty (no usable title) — every note requires a real title, so callers
// treat null as "invalid, reject" rather than "clear the title".
export function normalizeTitle(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length === 0) return null;
  return t.length > MAX_TITLE_LENGTH ? t.slice(0, MAX_TITLE_LENGTH).trim() : t;
}

// One normalization rule shared by gardener writes, the derived index, and
// the registry: lowercase, trim, collapse whitespace to single hyphens, drop
// anything outside [a-z0-9-]. Returns null for tags that normalize to empty.
export function normalizeTag(raw: string): string | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return t.length > 0 ? t : null;
}

// Normalize, dedupe, and cap a list of raw tags.
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const t = normalizeTag(r);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_TAGS);
}
