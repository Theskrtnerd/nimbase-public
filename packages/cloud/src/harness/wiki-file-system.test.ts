import { Bash, InMemoryFs, MountableFs } from "just-bash";
import { describe, expect, it } from "vitest";

import type { GardenerFs, WikiEntry, WikiReadFs } from "../memory/wiki/vfs";
import { VfsError } from "../memory/wiki/vfs";
import { deriveSummary, WikiFileSystem } from "./wiki-file-system";

// In-memory stand-in for the wiki VFS surface WikiFileSystem consumes. Cast to
// the real classes (they carry protected members, so structural typing alone
// can't satisfy them).
class FakeWikiVfs {
  entries = new Map<string, WikiEntry>();
  bodies = new Map<string, string>();
  writes: { path: string; body: string; summary: string }[] = [];
  moves: { from: string; to: string }[] = [];
  removals: string[] = [];

  seed(path: string, body: string, kind: WikiEntry["kind"] = "note") {
    this.entries.set(path, {
      path,
      kind,
      title: path,
      pinned: false,
      hasBody: true,
    });
    this.bodies.set(path, body);
  }

  listEntries(): Promise<WikiEntry[]> {
    return Promise.resolve([...this.entries.values()]);
  }

  read(path: string): Promise<string> {
    const body = this.bodies.get(path);
    if (body === undefined) {
      throw new VfsError(`no note at "${path}" — use tree to list paths`);
    }
    return Promise.resolve(body);
  }

  write(path: string, body: string, summary: string): Promise<string> {
    this.writes.push({ path, body, summary });
    this.seed(path, body);
    return Promise.resolve(`wrote ${path}`);
  }

  mv(from: string, to: string): Promise<string> {
    this.moves.push({ from, to });
    return Promise.resolve("moved");
  }

  rm(path: string): Promise<string> {
    this.removals.push(path);
    for (const key of [...this.entries.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.entries.delete(key);
        this.bodies.delete(key);
      }
    }
    return Promise.resolve("removed");
  }
}

function readWrite(fake: FakeWikiVfs): WikiFileSystem {
  return WikiFileSystem.readWrite(fake as unknown as GardenerFs);
}

function readOnly(fake: FakeWikiVfs): WikiFileSystem {
  return WikiFileSystem.readOnly(fake as unknown as WikiReadFs);
}

describe("deriveSummary", () => {
  it("skips frontmatter and heading markers", () => {
    expect(
      deriveSummary("---\ntitle: X\n---\n\n# Heading\nFirst real line."),
    ).toBe("Heading");
  });

  it("uses the first non-empty line and caps length", () => {
    const long = "x".repeat(300);
    expect(deriveSummary(long).length).toBe(140);
    expect(deriveSummary(long).endsWith("…")).toBe(true);
  });

  it("falls back for empty bodies", () => {
    expect(deriveSummary("---\ntitle: X\n---\n")).toBe(
      "written by the memory agent",
    );
  });
});

describe("WikiFileSystem", () => {
  it("reads note bodies and reports ENOENT/EISDIR", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("projects/nimbase/compile.md", "body text");
    const fs = readOnly(fake);
    expect(await fs.readFile("/projects/nimbase/compile.md")).toBe("body text");
    await expect(fs.readFile("/missing.md")).rejects.toThrow(/^ENOENT/);
    await expect(fs.readFile("/projects")).rejects.toThrow(/^EISDIR/);
  });

  it("routes .md writes to write() with a derived summary", async () => {
    const fake = new FakeWikiVfs();
    const fs = readWrite(fake);
    await fs.writeFile("/notes/new.md", "---\ntitle: New\n---\nA new note.");
    expect(fake.writes).toEqual([
      {
        path: "notes/new.md",
        body: "---\ntitle: New\n---\nA new note.",
        summary: "A new note.",
      },
    ]);
  });

  it("routes .json-named writes through write() too — no dataset path", async () => {
    const fake = new FakeWikiVfs();
    const fs = readWrite(fake);
    await fs.writeFile("/health/daily-steps.json", '[{"day":1}]');
    expect(fake.writes).toEqual([
      {
        path: "health/daily-steps.json",
        body: '[{"day":1}]',
        summary: '[{"day":1}]',
      },
    ]);
  });

  it("appendFile concatenates and creates missing files", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("log.md", "one\n");
    const fs = readWrite(fake);
    await fs.appendFile("/log.md", "two\n");
    expect(fake.writes.at(-1)?.body).toBe("one\ntwo\n");
    await fs.appendFile("/fresh.md", "start");
    expect(fake.writes.at(-1)).toMatchObject({
      path: "fresh.md",
      body: "start",
    });
  });

  it("read-only mode refuses mutations with EROFS", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("a.md", "x");
    const fs = readOnly(fake);
    await expect(fs.writeFile("/a.md", "y")).rejects.toThrow(/^EROFS/);
    await expect(fs.rm("/a.md")).rejects.toThrow(/^EROFS/);
    await expect(fs.mv("/a.md", "/b.md")).rejects.toThrow(/^EROFS/);
  });

  it("classifies root, folders, implicit dirs, and files via stat/exists", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("team/onboarding.md", "x");
    fake.entries.set("teams", {
      path: "teams",
      kind: "folder",
      title: "Teams",
      pinned: false,
      hasBody: false,
    });
    const fs = readOnly(fake);
    expect((await fs.stat("/")).isDirectory).toBe(true);
    expect((await fs.stat("/team")).isDirectory).toBe(true);
    expect((await fs.stat("/teams")).isDirectory).toBe(true);
    expect((await fs.stat("/team/onboarding.md")).isFile).toBe(true);
    expect(await fs.exists("/nope")).toBe(false);
    await expect(fs.stat("/nope")).rejects.toThrow(/^ENOENT/);
  });

  it("lists directory children with file types", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("team/onboarding.md", "x");
    fake.seed("team/handbook/intro.md", "y");
    fake.seed("root-note.md", "z");
    const fs = readOnly(fake);
    expect((await fs.readdir("/")).sort()).toEqual(["root-note.md", "team"]);
    const team = await fs.readdirWithFileTypes("/team");
    expect(team).toContainEqual({
      name: "onboarding.md",
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false,
    });
    expect(team).toContainEqual({
      name: "handbook",
      isFile: false,
      isDirectory: true,
      isSymbolicLink: false,
    });
    await expect(fs.readdir("/team/onboarding.md")).rejects.toThrow(/^ENOTDIR/);
    await expect(fs.readdir("/ghost")).rejects.toThrow(/^ENOENT/);
  });

  it("rm: requires -r for directories, honors force, delegates to the VFS", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("team/onboarding.md", "x");
    const fs = readWrite(fake);
    await expect(fs.rm("/team")).rejects.toThrow(/^EISDIR/);
    await fs.rm("/team", { recursive: true });
    expect(fake.removals).toEqual(["team"]);
    await expect(fs.rm("/ghost.md")).rejects.toThrow(/^ENOENT/);
    await expect(fs.rm("/ghost.md", { force: true })).resolves.toBeUndefined();
  });

  it("mv and cp map to wiki operations", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("a.md", "body a");
    const fs = readWrite(fake);
    await fs.mv("/a.md", "/b.md");
    expect(fake.moves).toEqual([{ from: "a.md", to: "b.md" }]);
    await fs.cp("/a.md", "/copy.md");
    expect(fake.writes.at(-1)).toMatchObject({
      path: "copy.md",
      body: "body a",
    });
    fake.seed("dir/child.md", "c");
    await expect(fs.cp("/dir", "/dir2", { recursive: true })).rejects.toThrow(
      /^ENOSYS/,
    );
  });

  it("getAllPaths serves the primed snapshot of file paths only", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("a.md", "x");
    fake.entries.set("folder", {
      path: "folder",
      kind: "folder",
      title: "F",
      pinned: false,
      hasBody: false,
    });
    const fs = readOnly(fake);
    expect(fs.getAllPaths()).toEqual([]);
    await fs.prime();
    expect(fs.getAllPaths()).toEqual(["/a.md"]);
  });

  it("mkdir succeeds implicitly but refuses paths held by files", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("a.md", "x");
    const fs = readWrite(fake);
    await expect(fs.mkdir("/anywhere/new")).resolves.toBeUndefined();
    await expect(fs.mkdir("/a.md")).rejects.toThrow(/^EEXIST/);
  });

  it("rejects link-family operations and tolerates chmod/utimes on live paths", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("a.md", "x");
    const fs = readWrite(fake);
    await expect(fs.symlink("/a.md", "/l")).rejects.toThrow(/^ENOSYS/);
    await expect(fs.link("/a.md", "/l")).rejects.toThrow(/^ENOSYS/);
    await expect(fs.readlink("/a.md")).rejects.toThrow(/^EINVAL/);
    await expect(fs.chmod("/a.md", 0o600)).resolves.toBeUndefined();
    await expect(fs.chmod("/nope", 0o600)).rejects.toThrow(/^ENOENT/);
    await expect(
      fs.utimes("/a.md", new Date(), new Date()),
    ).resolves.toBeUndefined();
  });

  it("surfaces VfsError messages (fence/pinned) unchanged to the shell", async () => {
    const fake = new FakeWikiVfs();
    fake.write = () => {
      throw new VfsError('"a.md" is pinned — the user locked it');
    };
    const fs = readWrite(fake);
    await expect(fs.writeFile("/a.md", "x")).rejects.toThrow(/pinned/);
  });
});

describe("WikiFileSystem under just-bash", () => {
  function mounted(fake: FakeWikiVfs) {
    const wiki = readWrite(fake);
    const fs = new MountableFs({
      base: new InMemoryFs(),
      mounts: [{ mountPoint: "/wiki", filesystem: wiki }],
    });
    return { bash: new Bash({ fs }), wiki };
  }

  it("ls/cat/grep read through the mount", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("team/onboarding.md", "---\ntitle: Onboarding\n---\nWelcome!");
    const { bash, wiki } = mounted(fake);
    await wiki.prime();

    const ls = await bash.exec("ls /wiki/team");
    expect(ls.stdout).toContain("onboarding.md");

    const cat = await bash.exec("cat /wiki/team/onboarding.md");
    expect(cat.stdout).toContain("Welcome!");

    const grep = await bash.exec("grep -r Welcome /wiki");
    expect(grep.stdout).toContain("onboarding.md");
  });

  it("bash redirection writes route through the VFS with derived summaries", async () => {
    const fake = new FakeWikiVfs();
    const { bash } = mounted(fake);
    const res = await bash.exec(
      "printf -- '---\\ntitle: Shell Note\\n---\\nMade from bash.\\n' > /wiki/shell-note.md",
    );
    expect(res.exitCode).toBe(0);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      path: "shell-note.md",
      summary: "Made from bash.",
    });
  });

  it("mv/rm shell commands hit the wiki, scratch stays in-memory", async () => {
    const fake = new FakeWikiVfs();
    fake.seed("old.md", "x");
    const { bash, wiki } = mounted(fake);
    await wiki.prime();

    expect((await bash.exec("mv /wiki/old.md /wiki/new.md")).exitCode).toBe(0);
    expect(fake.moves).toEqual([{ from: "old.md", to: "new.md" }]);

    const scratch = await bash.exec(
      "mkdir -p /output && echo artifact > /output/artifact.html && cat /output/artifact.html",
    );
    expect(scratch.stdout.trim()).toBe("artifact");
    expect(fake.writes).toHaveLength(0);
  });
});
