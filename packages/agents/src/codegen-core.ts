import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Loader for the eve.dev-style agent definition directories:
// definitions/<agent>/instructions.md plus skills in two forms —
//   flat:     skills/<slug>.md
//   packaged: skills/<slug>/SKILL.md + sibling reference files (any depth)
// Slugs come from the file/directory name; frontmatter carries only the
// required `description` (written as a trigger condition — it's what the
// model routes on). Sibling files ride along as `files` and are materialized
// next to SKILL.md by the harness adapter. Used by the codegen CLI (which
// embeds the result in src/generated.ts, since Next.js can't import .md) and
// by the drift test that keeps generated.ts honest. Runtime code imports
// generated.ts only — this module touches node:fs and must stay out of app
// bundles.

export interface AgentSkillFile {
  path: string;
  content: string;
}

export interface AgentSkillDefinition {
  name: string;
  description: string;
  content: string;
  files?: AgentSkillFile[];
}

export interface AgentDefinition {
  instructions: string;
  skills: AgentSkillDefinition[];
}

export type AgentDefinitions = Record<string, AgentDefinition>;

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Minimal frontmatter parse: a leading "---\n...\n---\n" block of
// "key: value" lines. Skills only need description (the name is derived from
// the slug), so this stays hand-rolled instead of pulling in a YAML
// dependency. Unknown keys — including a stray legacy `name:` — are ignored.
export function parseSkillFile(
  raw: string,
  slug: string,
  file: string,
): AgentSkillDefinition {
  if (!KEBAB_CASE.test(slug)) {
    throw new Error(`skill ${file}: slug "${slug}" is not kebab-case`);
  }
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match?.[1]) {
    throw new Error(`skill ${file} is missing its frontmatter block`);
  }
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const description = fields.get("description");
  if (!description) {
    throw new Error(`skill ${file} needs a "description" frontmatter field`);
  }
  return {
    name: slug,
    description,
    content: raw.slice(match[0].length).trim(),
  };
}

// Recursively collect a packaged skill's sibling files as skill-relative
// POSIX paths. Dotfiles/dot-directories (.DS_Store and friends) are skipped;
// the root SKILL.md is the skill body, not a sibling. Paths are built from
// dirent names so they can't be absolute or contain ".." — the guard is a
// belt-and-braces check because the harness adapter rejects such paths at
// runtime, and codegen is the cheaper place to fail.
function collectSkillFiles(dir: string, prefix: string): AgentSkillFile[] {
  const out: AgentSkillFile[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectSkillFiles(join(dir, entry.name), rel));
      continue;
    }
    if (rel === "SKILL.md") continue;
    if (rel.startsWith("/") || rel.split("/").includes("..")) {
      throw new Error(
        `skill file path "${rel}" must be relative without ".." segments`,
      );
    }
    out.push({
      path: rel,
      content: readFileSync(join(dir, entry.name), "utf8"),
    });
  }
  return out;
}

function loadSkills(skillsDir: string): AgentSkillDefinition[] {
  const skills: AgentSkillDefinition[] = [];
  const seen = new Set<string>();
  const entries = readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    let skill: AgentSkillDefinition;
    if (entry.isDirectory()) {
      const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        throw new Error(
          `packaged skill "${entry.name}" in ${skillsDir} is missing SKILL.md`,
        );
      }
      skill = parseSkillFile(
        readFileSync(skillMdPath, "utf8"),
        entry.name,
        `${entry.name}/SKILL.md`,
      );
      const files = collectSkillFiles(join(skillsDir, entry.name), "");
      if (files.length > 0) skill = { ...skill, files };
    } else if (entry.name.endsWith(".md")) {
      skill = parseSkillFile(
        readFileSync(join(skillsDir, entry.name), "utf8"),
        entry.name.slice(0, -".md".length),
        entry.name,
      );
    } else {
      throw new Error(
        `skills/ entry "${entry.name}" in ${skillsDir} is neither a .md file nor a packaged skill directory`,
      );
    }
    if (seen.has(skill.name)) {
      throw new Error(`duplicate skill slug "${skill.name}" in ${skillsDir}`);
    }
    seen.add(skill.name);
    skills.push(skill);
  }
  return skills;
}

export function loadAgentDefinitions(definitionsDir: string): AgentDefinitions {
  const agents: AgentDefinitions = {};
  const agentNames = readdirSync(definitionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const agentName of agentNames) {
    const agentDir = join(definitionsDir, agentName);
    const instructions = readFileSync(
      join(agentDir, "instructions.md"),
      "utf8",
    ).trim();
    agents[agentName] = {
      instructions,
      skills: loadSkills(join(agentDir, "skills")),
    };
  }
  return agents;
}

export function renderGeneratedModule(agents: AgentDefinitions): string {
  return [
    "// AUTO-GENERATED from definitions/**.md — do not edit by hand.",
    "// Regenerate with `pnpm -F @acme/agents codegen`; the drift test in",
    "// generated.test.ts fails when this file is stale.",
    'import type { AgentDefinitions } from "./codegen-core"',
    "",
    `export const agentDefinitions: AgentDefinitions = ${JSON.stringify(agents, null, 2)}`,
    "",
  ].join("\n");
}
