import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadAgentDefinitions, parseSkillFile } from "./codegen-core";

// Each test builds a throwaway definitions/ tree on disk, because the loader
// is a filesystem walker — faking fs would test the mock, not the walk.
let dir: string | undefined;

function makeDefs(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "agents-defs-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const INSTRUCTIONS = "You are a test agent.\n";
const SKILL = "---\ndescription: Use when testing.\n---\n\nBody here.\n";

describe("loadAgentDefinitions", () => {
  it("loads a flat skill with its slug from the filename", () => {
    const defs = loadAgentDefinitions(
      makeDefs({
        "demo/instructions.md": INSTRUCTIONS,
        "demo/skills/my-skill.md": SKILL,
      }),
    );
    expect(defs.demo?.skills).toEqual([
      {
        name: "my-skill",
        description: "Use when testing.",
        content: "Body here.",
      },
    ]);
  });

  it("ignores a stray name: frontmatter key (filename wins)", () => {
    const defs = loadAgentDefinitions(
      makeDefs({
        "demo/instructions.md": INSTRUCTIONS,
        "demo/skills/real-slug.md":
          "---\nname: other-name\ndescription: Use when testing.\n---\n\nBody.\n",
      }),
    );
    expect(defs.demo?.skills[0]?.name).toBe("real-slug");
  });

  it("loads a packaged skill with nested sibling files, skipping dotfiles", () => {
    const defs = loadAgentDefinitions(
      makeDefs({
        "demo/instructions.md": INSTRUCTIONS,
        "demo/skills/packaged/SKILL.md": SKILL,
        "demo/skills/packaged/references/codes.md": "code table\n",
        "demo/skills/packaged/notes.txt": "extra\n",
        "demo/skills/packaged/.DS_Store": "junk",
        "demo/skills/packaged/.hidden/secret.md": "junk",
      }),
    );
    expect(defs.demo?.skills).toEqual([
      {
        name: "packaged",
        description: "Use when testing.",
        content: "Body here.",
        files: [
          { path: "notes.txt", content: "extra\n" },
          { path: "references/codes.md", content: "code table\n" },
        ],
      },
    ]);
  });

  it("omits files entirely for a packaged skill with only SKILL.md", () => {
    const defs = loadAgentDefinitions(
      makeDefs({
        "demo/instructions.md": INSTRUCTIONS,
        "demo/skills/lonely/SKILL.md": SKILL,
      }),
    );
    expect(defs.demo?.skills[0]).not.toHaveProperty("files");
  });

  it("rejects a packaged skill directory without SKILL.md", () => {
    const root = makeDefs({
      "demo/instructions.md": INSTRUCTIONS,
      "demo/skills/broken/references/x.md": "orphan\n",
    });
    expect(() => loadAgentDefinitions(root)).toThrow(/missing SKILL\.md/);
  });

  it("rejects a top-level skills entry that is not markdown", () => {
    const root = makeDefs({
      "demo/instructions.md": INSTRUCTIONS,
      "demo/skills/stray.txt": "not a skill\n",
    });
    expect(() => loadAgentDefinitions(root)).toThrow(
      /neither a \.md file nor a packaged skill directory/,
    );
  });

  it("rejects duplicate slugs across flat and packaged forms", () => {
    const root = makeDefs({
      "demo/instructions.md": INSTRUCTIONS,
      "demo/skills/twin.md": SKILL,
      "demo/skills/twin/SKILL.md": SKILL,
    });
    expect(() => loadAgentDefinitions(root)).toThrow(/duplicate skill slug/);
  });

  it("rejects non-kebab-case slugs", () => {
    const root = makeDefs({
      "demo/instructions.md": INSTRUCTIONS,
      "demo/skills/Bad_Slug.md": SKILL,
    });
    expect(() => loadAgentDefinitions(root)).toThrow(/not kebab-case/);
  });
});

describe("parseSkillFile", () => {
  it("derives the name from the slug and parses description + body", () => {
    expect(parseSkillFile(SKILL, "demo", "demo.md")).toEqual({
      name: "demo",
      description: "Use when testing.",
      content: "Body here.",
    });
  });

  it("rejects files without a frontmatter block", () => {
    expect(() => parseSkillFile("no frontmatter", "x", "x.md")).toThrow(
      /missing its frontmatter/,
    );
  });

  it("rejects frontmatter without a description", () => {
    expect(() =>
      parseSkillFile("---\nname: only\n---\nbody", "x", "x.md"),
    ).toThrow(/needs a "description"/);
  });
});
