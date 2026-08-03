/**
 * Pure request-path → stored-asset mapping for published docs sites.
 *
 * Kept out of the route so it can be tested without pulling in Clerk, the DB,
 * or S3 — the route stays a thin auth-and-fetch shell over these.
 */

/**
 * Map a request path to a file in the build's `dist/`.
 *
 * Astro's static output writes `about/index.html`, so an extensionless path is
 * a directory route. Anything carrying an extension is served verbatim.
 */
export function resolveAssetPath(rest: string[]): string {
  const joined = rest.filter((s) => s.length > 0).join("/");
  if (joined === "") return "index.html";
  const last = joined.split("/").pop() ?? "";
  if (last.includes(".")) return joined;
  return `${joined}/index.html`;
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json",
};

/** Never sniffs; an unknown extension is served as an opaque download. */
export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
