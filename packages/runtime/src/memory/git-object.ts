import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export type GitObjectType = "blob" | "tree" | "commit";

export interface LooseGitObject {
  oid: string;
  compressed: Uint8Array;
}

interface TreeNode {
  blobs: Map<string, string>;
  directories: Map<string, TreeNode>;
}

function looseObject(type: GitObjectType, content: Uint8Array): LooseGitObject {
  const header = Buffer.from(`${type} ${String(content.byteLength)}\0`, "utf8");
  const bytes = Buffer.concat([header, content]);
  // SHA-1 is required by the Git object format. It is an interoperability
  // identifier here, not a security primitive or integrity decision.
  const oid = createHash("sha1").update(bytes).digest("hex");
  return { oid, compressed: deflateSync(bytes) };
}

export function createGitBlob(body: string): LooseGitObject {
  return looseObject("blob", Buffer.from(body, "utf8"));
}

function validateGitPath(path: string): string[] {
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    path.endsWith("/") ||
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes("\0"),
    )
  ) {
    throw new Error(`cannot project invalid memory path "${path}"`);
  }
  return parts;
}

function treeFromEntries(entries: Readonly<Record<string, string>>): TreeNode {
  const root: TreeNode = { blobs: new Map(), directories: new Map() };
  for (const [path, oid] of Object.entries(entries)) {
    if (!/^[0-9a-f]{40}$/.test(oid)) {
      throw new Error(`invalid Git blob id for "${path}"`);
    }
    const parts = validateGitPath(path);
    const leaf = parts.pop();
    if (!leaf) throw new Error(`cannot project invalid memory path "${path}"`);
    let node = root;
    for (const part of parts) {
      if (node.blobs.has(part)) {
        throw new Error(`memory path collides with file "${part}"`);
      }
      const child: TreeNode = node.directories.get(part) ?? {
        blobs: new Map(),
        directories: new Map(),
      };
      node.directories.set(part, child);
      node = child;
    }
    if (node.directories.has(leaf) || node.blobs.has(leaf)) {
      throw new Error(`duplicate or colliding memory path "${path}"`);
    }
    node.blobs.set(leaf, oid);
  }
  return root;
}

function compareTreeNames(
  left: { name: string; directory: boolean },
  right: { name: string; directory: boolean },
): number {
  const leftBytes = Buffer.from(`${left.name}${left.directory ? "/" : ""}`);
  const rightBytes = Buffer.from(`${right.name}${right.directory ? "/" : ""}`);
  return Buffer.compare(leftBytes, rightBytes);
}

function createTreeObjects(node: TreeNode): {
  oid: string;
  objects: LooseGitObject[];
} {
  const objects: LooseGitObject[] = [];
  const entries: {
    name: string;
    directory: boolean;
    oid: string;
  }[] = [];

  for (const [name, oid] of node.blobs) {
    entries.push({ name, directory: false, oid });
  }
  for (const [name, child] of node.directories) {
    const result = createTreeObjects(child);
    objects.push(...result.objects);
    entries.push({ name, directory: true, oid: result.oid });
  }
  entries.sort(compareTreeNames);

  const body = Buffer.concat(
    entries.flatMap((entry) => [
      Buffer.from(
        `${entry.directory ? "40000" : "100644"} ${entry.name}\0`,
        "utf8",
      ),
      Buffer.from(entry.oid, "hex"),
    ]),
  );
  const tree = looseObject("tree", body);
  objects.push(tree);
  return { oid: tree.oid, objects };
}

export function createGitTrees(entries: Readonly<Record<string, string>>): {
  rootOid: string;
  objects: LooseGitObject[];
} {
  const result = createTreeObjects(treeFromEntries(entries));
  return { rootOid: result.oid, objects: result.objects };
}

export function createGitCommit(input: {
  treeOid: string;
  parentOid: string | null;
  message: string;
  createdAt: Date;
}): LooseGitObject {
  if (!/^[0-9a-f]{40}$/.test(input.treeOid)) {
    throw new Error("invalid Git tree id");
  }
  if (input.parentOid && !/^[0-9a-f]{40}$/.test(input.parentOid)) {
    throw new Error("invalid Git parent id");
  }
  const timestamp = Math.floor(input.createdAt.getTime() / 1000);
  const identity = `Nimbase Memory <memory@nimbase.local> ${String(timestamp)} +0000`;
  const lines = [`tree ${input.treeOid}`];
  if (input.parentOid) lines.push(`parent ${input.parentOid}`);
  lines.push(
    `author ${identity}`,
    `committer ${identity}`,
    "",
    input.message,
    "",
  );
  return looseObject("commit", Buffer.from(lines.join("\n"), "utf8"));
}
