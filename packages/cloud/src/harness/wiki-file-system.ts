import { posix } from "node:path";
import type {
  BufferEncoding,
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  RmOptions,
} from "just-bash";

import type { GardenerFs, WikiEntry, WikiReadFs } from "../memory/wiki/vfs";
import { VfsError } from "../memory/wiki/vfs";

// just-bash `IFileSystem` over the wiki VFS. Mounted at /wiki via MountableFs,
// which hands us mount-relative paths ("/a/b.md" for /wiki/a/b.md) — so every
// fence and pinned rules enforced by WikiReadFs/GardenerFs apply to the
// harness's built-in read/write/edit/bash/grep/glob/ls tools with no new
// authorization paths.
//
// Write summaries: the harness's generic file tools carry no summary argument,
// so writes derive one from the body (frontmatter title / first line). The
// wrapped GardenerFs keeps recording ops exactly as in the legacy loop.

// Structural equivalents of just-bash fs types it doesn't export from its
// package root; `implements IFileSystem` still checks them structurally.
interface ReadFileOptions {
  encoding?: BufferEncoding | null;
}
interface WriteFileOptions {
  encoding?: BufferEncoding;
}
interface DirentEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

const MODE_FILE = 0o644;
const MODE_DIR = 0o755;

// Node-style error with a `code` so just-bash command error rendering and
// `force`/exists checks behave like they do over a real filesystem.
function fsError(code: string, detail: string): Error {
  const err = new Error(`${code}: ${detail}`);
  (err as Error & { code: string }).code = code;
  return err;
}

function isVfsMissing(err: unknown): boolean {
  return err instanceof VfsError && /no (note|dataset)? ?at /.test(err.message);
}

// "/a/b.md" (mount-relative) → "a/b.md" (wiki path).
function toWikiPath(path: string): string {
  const normalized = posix.normalize(path);
  let start = 0;
  let end = normalized.length;
  while (normalized[start] === "/") start++;
  while (end > start && normalized[end - 1] === "/") end--;
  return normalized.slice(start, end);
}

function decode(content: FileContent): string {
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
}

const SUMMARY_MAX = 140;

// A serviceable one-liner from the body: first non-frontmatter, non-heading-
// marker text line. Blander than a model-written summary (documented spec
// trade-off); falls back to a fixed phrase for empty bodies.
export function deriveSummary(body: string): string {
  const withoutFrontmatter = body.replace(/^---\n[\s\S]*?\n---\n?/, "");
  for (const raw of withoutFrontmatter.split("\n")) {
    const line = raw.replace(/^#+\s*/, "").trim();
    if (line) {
      return line.length > SUMMARY_MAX
        ? `${line.slice(0, SUMMARY_MAX - 1)}…`
        : line;
    }
  }
  return "written by the memory agent";
}

export class WikiFileSystem implements IFileSystem {
  // Sync snapshot of live wiki file paths (mount-relative, leading "/") for
  // the sync-only getAllPaths() glob hook. Refreshed by every async listing/
  // read; primed by the runner via prime() before the first turn.
  private pathsSnapshot: string[] = [];

  constructor(
    private readonly wiki: WikiReadFs,
    // Present in read-write mode; null makes every mutation throw EROFS.
    private readonly gardener: GardenerFs | null,
  ) {}

  static readOnly(wiki: WikiReadFs): WikiFileSystem {
    return new WikiFileSystem(wiki, null);
  }

  static readWrite(gardener: GardenerFs): WikiFileSystem {
    return new WikiFileSystem(gardener, gardener);
  }

  async prime(): Promise<void> {
    await this.entries();
  }

  private async entries(): Promise<WikiEntry[]> {
    const entries = await this.wiki.listEntries();
    this.pathsSnapshot = entries
      .filter((e) => e.kind !== "folder")
      .map((e) => `/${e.path}`);
    return entries;
  }

  private requireWrite(op: string, path: string): GardenerFs {
    if (!this.gardener) {
      throw fsError("EROFS", `read-only file system, ${op} '${path}'`);
    }
    return this.gardener;
  }

  // A path is a directory when it's "/", a folder node, or a prefix of any
  // live node path.
  private async classify(
    path: string,
  ): Promise<{ kind: "file" | "dir"; entry?: WikiEntry } | null> {
    const wikiPath = toWikiPath(path);
    if (wikiPath === "") return { kind: "dir" };
    const entries = await this.entries();
    const exact = entries.find((e) => e.path === wikiPath);
    if (exact) {
      return exact.kind === "folder"
        ? { kind: "dir", entry: exact }
        : { kind: "file", entry: exact };
    }
    const prefix = `${wikiPath}/`;
    if (entries.some((e) => e.path.startsWith(prefix))) return { kind: "dir" };
    return null;
  }

  async readFile(
    path: string,
    _options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const wikiPath = toWikiPath(path);
    try {
      return await this.wiki.read(wikiPath);
    } catch (err) {
      if (isVfsMissing(err)) {
        if ((await this.classify(path))?.kind === "dir") {
          throw fsError(
            "EISDIR",
            `illegal operation on a directory, read '${path}'`,
          );
        }
        throw fsError("ENOENT", `no such file or directory, open '${path}'`);
      }
      throw err;
    }
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.readFile(path));
  }

  async writeFile(
    path: string,
    content: FileContent,
    _options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    const gardener = this.requireWrite("open", path);
    const wikiPath = toWikiPath(path);
    const body = decode(content);
    await gardener.write(wikiPath, body, deriveSummary(body));
    this.pathsSnapshot = [];
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    let existing = "";
    try {
      existing = await this.readFile(path);
    } catch (err) {
      if (!(err instanceof Error && err.message.startsWith("ENOENT"))) {
        throw err;
      }
    }
    await this.writeFile(path, existing + decode(content), options);
  }

  async exists(path: string): Promise<boolean> {
    return (await this.classify(path)) !== null;
  }

  async stat(path: string): Promise<FsStat> {
    const classified = await this.classify(path);
    if (!classified) {
      throw fsError("ENOENT", `no such file or directory, stat '${path}'`);
    }
    return {
      isFile: classified.kind === "file",
      isDirectory: classified.kind === "dir",
      isSymbolicLink: false,
      mode: classified.kind === "file" ? MODE_FILE : MODE_DIR,
      // Body length would require an S3 read per `ls` entry; documented as 0.
      size: 0,
      mtime: new Date(0),
    };
  }

  lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  async mkdir(path: string, _options?: MkdirOptions): Promise<void> {
    // Wiki folders are implicit in note paths (permission-anchor folder nodes
    // are never agent-created), so mkdir just validates and succeeds.
    if ((await this.classify(path))?.kind === "file") {
      throw fsError("EEXIST", `file already exists, mkdir '${path}'`);
    }
  }

  async readdir(path: string): Promise<string[]> {
    return (await this.readdirWithFileTypes(path)).map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const classified = await this.classify(path);
    if (!classified) {
      throw fsError("ENOENT", `no such file or directory, scandir '${path}'`);
    }
    if (classified.kind === "file") {
      throw fsError("ENOTDIR", `not a directory, scandir '${path}'`);
    }
    const wikiPath = toWikiPath(path);
    const prefix = wikiPath === "" ? "" : `${wikiPath}/`;
    const names = new Map<string, boolean>(); // name → isFile
    for (const entry of await this.entries()) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      if (!rest) continue;
      const [head] = rest.split("/");
      if (!head) continue;
      const isLeaf = !rest.includes("/");
      const isFile = isLeaf && entry.kind !== "folder";
      names.set(head, (names.get(head) ?? false) || isFile);
    }
    return [...names.entries()].map(([name, isFile]) => ({
      name,
      isFile,
      isDirectory: !isFile,
      isSymbolicLink: false,
    }));
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const gardener = this.requireWrite("unlink", path);
    const classified = await this.classify(path);
    if (!classified) {
      if (options?.force) return;
      throw fsError("ENOENT", `no such file or directory, rm '${path}'`);
    }
    if (classified.kind === "dir" && !options?.recursive) {
      throw fsError("EISDIR", `is a directory, rm '${path}' (use -r)`);
    }
    await gardener.rm(toWikiPath(path));
    this.pathsSnapshot = [];
  }

  async cp(src: string, dest: string, _options?: CpOptions): Promise<void> {
    const classified = await this.classify(src);
    if (classified?.kind === "dir") {
      throw fsError(
        "ENOSYS",
        `copying directories is not supported on the wiki, cp '${src}'`,
      );
    }
    await this.writeFile(dest, await this.readFile(src));
  }

  async mv(src: string, dest: string): Promise<void> {
    const gardener = this.requireWrite("rename", src);
    await gardener.mv(toWikiPath(src), toWikiPath(dest));
    this.pathsSnapshot = [];
  }

  resolvePath(base: string, path: string): string {
    return posix.resolve(base, path);
  }

  getAllPaths(): string[] {
    return this.pathsSnapshot;
  }

  async chmod(path: string, _mode: number): Promise<void> {
    // Permissions don't exist on the wiki; succeed on live paths so innocuous
    // shell patterns (chmod after write) don't abort an agent turn.
    if (!(await this.exists(path))) {
      throw fsError("ENOENT", `no such file or directory, chmod '${path}'`);
    }
  }

  symlink(_target: string, linkPath: string): Promise<void> {
    return Promise.reject(
      fsError(
        "ENOSYS",
        `symlinks are not supported on the wiki, '${linkPath}'`,
      ),
    );
  }

  link(_existingPath: string, newPath: string): Promise<void> {
    return Promise.reject(
      fsError(
        "ENOSYS",
        `hard links are not supported on the wiki, '${newPath}'`,
      ),
    );
  }

  readlink(path: string): Promise<string> {
    return Promise.reject(
      fsError("EINVAL", `invalid argument, readlink '${path}'`),
    );
  }

  async realpath(path: string): Promise<string> {
    if (!(await this.exists(path))) {
      throw fsError("ENOENT", `no such file or directory, realpath '${path}'`);
    }
    return posix.normalize(path.startsWith("/") ? path : `/${path}`);
  }

  async utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
    if (!(await this.exists(path))) {
      throw fsError("ENOENT", `no such file or directory, utimes '${path}'`);
    }
  }
}
