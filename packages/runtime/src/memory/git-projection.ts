import type { MemoryMutationChange } from "@acme/db/schema";

import type { LooseGitObject } from "./git-object";
import { createGitBlob } from "./git-object";

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function applyMemoryChanges(
  current: Readonly<Record<string, string>>,
  changes: MemoryMutationChange[],
  versionBodies: ReadonlyMap<string, string>,
): { entries: Record<string, string>; blobs: LooseGitObject[] } {
  let entries = { ...current };
  const blobs: LooseGitObject[] = [];

  for (const change of changes) {
    if (change.type === "upsert") {
      const body = versionBodies.get(change.versionId);
      if (body === undefined) {
        throw new Error(`memory version ${change.versionId} does not exist`);
      }
      const blob = createGitBlob(body);
      blobs.push(blob);
      entries[change.path] = blob.oid;
      continue;
    }
    if (change.type === "delete") {
      entries = Object.fromEntries(
        Object.entries(entries).filter(
          ([path]) => !pathMatchesPrefix(path, change.path),
        ),
      );
      continue;
    }

    const moved: Record<string, string> = {};
    for (const [path, oid] of Object.entries(entries)) {
      if (!pathMatchesPrefix(path, change.from)) continue;
      const suffix = path.slice(change.from.length);
      moved[`${change.to}${suffix}`] = oid;
      delete entries[path];
    }
    for (const [path, oid] of Object.entries(moved)) {
      if (entries[path]) {
        throw new Error(`memory move collides with existing path "${path}"`);
      }
      entries[path] = oid;
    }
  }
  return { entries, blobs };
}
