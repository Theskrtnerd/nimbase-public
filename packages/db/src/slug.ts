// Reserved subdomains/paths that must never become a workspace or group slug,
// so they can't shadow platform hosts or the app itself.
export const RESERVED_SLUGS = [
  "app",
  "www",
  "api",
  "admin",
  "mcp",
  "auth",
  "login",
  "dashboard",
  "static",
  "assets",
  "cdn",
  "mail",
  "status",
] as const;

export function slugifyName(name: string): string {
  let slug = "";
  for (const char of name.toLowerCase()) {
    const code = char.charCodeAt(0);
    const alphanumeric =
      (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (alphanumeric) {
      slug += char;
    } else if (slug && !slug.endsWith("-")) {
      slug += "-";
    }
  }
  return slug.endsWith("-") ? slug.slice(0, -1) : slug;
}

// Leave room for `-<6 letters>` so collision suffixes stay within the shared
// 64-character deployment slug contract.
export function resourceSlugBase(name: string, fallback: string): string {
  const truncated = slugifyName(name).slice(0, 57);
  return (
    (truncated.endsWith("-") ? truncated.slice(0, -1) : truncated) || fallback
  );
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug.toLowerCase());
}

// A 6-letter lowercase token (a–z) used to disambiguate colliding slugs, e.g.
// `acme-qkzrmf`. Letters only — no digits, so slugs never carry numbers. Web
// Crypto (not node:crypto) so this works on both Node and Edge runtimes. Reject
// the final 22 byte values so every letter has equal probability.
export function randomSlugSuffix(): string {
  let out = "";
  while (out.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(6 - out.length));
    for (const byte of bytes) {
      if (byte >= 234) continue;
      out += String.fromCharCode(97 + (byte % 26));
    }
  }
  return out;
}

// First slug not already taken and not reserved: the bare base if free, then
// `base-<6 random letters>` (e.g. acme, acme-qkzrmf, acme-fwtpld) until one
// lands. A random suffix — not a running counter — so URLs never expose a
// workspace count and two same-named workspaces don't reveal their order.
// `randomSuffix` is injectable so tests stay deterministic.
export function nextAvailableSlug(
  base: string,
  taken: ReadonlySet<string>,
  randomSuffix: () => string = randomSlugSuffix,
): string {
  if (!taken.has(base) && !isReservedSlug(base)) return base;
  // 26^6 ≈ 309M tokens: a free one is found almost immediately. The bound is a
  // safety net; the DB unique index is the ultimate collision guard.
  for (let attempt = 0; attempt < 100; attempt++) {
    const slug = `${base}-${randomSuffix()}`;
    if (!taken.has(slug) && !isReservedSlug(slug)) return slug;
  }
  throw new Error(`Could not find an available slug for "${base}"`);
}
