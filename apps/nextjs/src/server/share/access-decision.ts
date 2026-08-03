import type { ArtifactVisibility } from "@acme/db/schema";

export type ShareAccess = "serve" | "forbidden";

/**
 * Pure access decision for a ready artifact at `/s/[slug]`. A reader (someone
 * with read access to the artifact's folder) always sees it; otherwise the
 * visibility level governs the public link.
 */
export function decideShareAccess(opts: {
  visibility: ArtifactVisibility;
  isReader: boolean;
}): ShareAccess {
  // Only the exact public value opens anonymous access. Any legacy database
  // value therefore continues to fail closed until its migration runs.
  return opts.isReader || opts.visibility === "public" ? "serve" : "forbidden";
}
