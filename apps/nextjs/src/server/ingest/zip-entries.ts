import { unzipSync } from "fflate";

import type { SourceKind } from "@acme/db/schema";

// Pure archive rules — detection, filtering, and caps. Type-only imports, so
// no S3, no database, no server-only: the policy that decides what a .zip is
// allowed to become is testable on its own. The side-effecting expansion that
// turns these entries into Source rows lives in expand-zip.ts.

const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

/**
 * Only a "file" source can be an archive. Browsers disagree on the zip mime
 * (and some send none at all), so the filename is a tiebreaker rather than the
 * mime being the sole signal.
 *
 * Takes the row shape rather than loose args so presign (deciding a size cap)
 * and extract (deciding whether to expand) cannot drift on the definition.
 */
export function isZipSource(source: {
  kind: SourceKind;
  mimeType: string | null;
  originalFilename: string | null;
}): boolean {
  if (source.kind !== "file") return false;
  if (source.mimeType && ZIP_MIME_TYPES.has(source.mimeType)) return true;
  return /\.zip$/i.test(source.originalFilename ?? "");
}

// Caps. These bound the blast radius of one upload: a 20k-file monorepo zip or
// a zip bomb must not turn into 20k compile jobs or exhaust the worker's heap.
export const MAX_ENTRIES = 200;
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

// Paths that are never company memory — VCS internals, dependency trees,
// build output, and the resource-fork junk macOS's Archive Utility adds.
const JUNK_SEGMENTS = new Set([
  "__MACOSX",
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".venv",
  "__pycache__",
]);

// Extension → mime for entries. Anything absent still ingests (the extract
// pipeline falls back to a metadata-only raw.md), it just isn't text-native.
const MIME_FOR_EXT: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  txt: "text/plain",
  text: "text/plain",
  csv: "text/csv",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export interface ZipEntry {
  /** Slash-separated path inside the archive. */
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  ext: string;
}

export interface ZipSelection {
  entries: ZipEntry[];
  /** Human-readable "path — reason" lines, surfaced on the container source. */
  skipped: string[];
}

function extensionOf(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match?.[1]?.toLowerCase() ?? "";
}

function isJunkPath(path: string): boolean {
  return path.split("/").some(
    (segment) =>
      JUNK_SEGMENTS.has(segment) ||
      // Dotfiles and dot-directories (.DS_Store, .env, .github/...).
      (segment.startsWith(".") && segment !== "." && segment !== ".."),
  );
}

/**
 * Decides which archive entries become Sources. Pure and synchronous so the
 * filtering rules — junk paths, per-entry and total size caps, entry count,
 * nested archives — are unit-testable without S3 or a database.
 */
export function selectZipEntries(archive: Uint8Array): ZipSelection {
  const unzipped = unzipSync(archive);
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  // Deterministic order so a re-upload of the same archive picks the same
  // entries when a cap truncates the list.
  for (const path of Object.keys(unzipped).sort()) {
    const bytes = unzipped[path];
    if (!bytes) continue;
    // Directory entries carry a trailing slash and no payload.
    if (path.endsWith("/")) continue;
    if (isJunkPath(path)) continue;

    if (entries.length >= MAX_ENTRIES) {
      skipped.push(`${path} — archive exceeds ${MAX_ENTRIES} files`);
      continue;
    }
    if (bytes.length === 0) {
      skipped.push(`${path} — empty file`);
      continue;
    }
    if (bytes.length > MAX_ENTRY_BYTES) {
      skipped.push(`${path} — file larger than ${MAX_ENTRY_BYTES} bytes`);
      continue;
    }
    const ext = extensionOf(path);
    if (ext === "zip") {
      // No recursion: one level of expansion only, so a nested archive can't
      // fan out combinatorially.
      skipped.push(`${path} — nested archives are not expanded`);
      continue;
    }
    if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
      skipped.push(`${path} — archive exceeds ${MAX_TOTAL_BYTES} bytes total`);
      continue;
    }

    totalBytes += bytes.length;
    entries.push({
      path,
      bytes,
      ext,
      mimeType: MIME_FOR_EXT[ext] ?? "application/octet-stream",
    });
  }

  return { entries, skipped };
}

export interface ExpandZipResult {
  childCount: number;
  /**
   * Extract jobs for the newly created children, for the caller to dispatch.
   * Typed structurally (rather than importing @acme/cloud's ExtractJobData)
   * to keep this module free of runtime dependencies.
   */
  childJobs: { jobId: string; workspaceId: string; sourceId: string }[];
  skipped: string[];
  /** Set when a plan limit stopped the expansion partway. */
  limitReached: string | null;
}

/**
 * The container's raw.md body: a manifest of what the archive became. It is
 * stored for the source detail view but never compiled — see extract.ts.
 */
export function buildArchiveManifest(result: ExpandZipResult): string {
  const lines = [
    `Expanded into ${result.childCount} ${
      result.childCount === 1 ? "source" : "sources"
    }.`,
  ];
  if (result.limitReached) {
    lines.push("", `Stopped early: ${result.limitReached}`);
  }
  if (result.skipped.length > 0) {
    lines.push("", "Skipped:", ...result.skipped.map((line) => `- ${line}`));
  }
  return lines.join("\n");
}
