import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadAgentDefinitions, renderGeneratedModule } from "./codegen-core";
import { agentDefinitions } from "./generated";

const definitionsDir = join(import.meta.dirname, "..", "definitions");

describe("generated.ts", () => {
  it("matches a fresh codegen run over definitions/ (run `pnpm -F @acme/agents codegen` when this fails)", () => {
    const fresh = loadAgentDefinitions(definitionsDir);
    expect(agentDefinitions).toEqual(fresh);
    // Render equality too, so formatting drift in the committed file shows up.
    expect(renderGeneratedModule(agentDefinitions)).toBe(
      renderGeneratedModule(fresh),
    );
  });

  it("covers the four agent surfaces", () => {
    expect(Object.keys(agentDefinitions).sort()).toEqual([
      "artifact",
      "biographer",
      "chat",
      "gardener",
    ]);
  });

  it("every skill has a kebab-case name and a description", () => {
    for (const [agent, def] of Object.entries(agentDefinitions)) {
      expect(def.instructions.length, `${agent} instructions`).toBeGreaterThan(
        0,
      );
      for (const skill of def.skills) {
        expect(skill.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(skill.description.length).toBeGreaterThan(0);
        expect(skill.content.length).toBeGreaterThan(0);
        for (const file of skill.files ?? []) {
          expect(file.path).not.toMatch(/^\//);
          expect(file.path.split("/")).not.toContain("..");
          expect(file.content.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
