import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerMemory } from "../memory";
import { parseConnectorConfig, registerSync } from "./index";

function child(parent: Command, name: string): Command {
  const found = parent.commands.find((command) => command.name() === name);
  if (!found) throw new Error(`no "${name}" beneath "${parent.name()}"`);
  return found;
}

describe("sync command tree", () => {
  it("groups every standing channel operation under sync", () => {
    const program = new Command();
    registerSync(program);

    const sync = child(program, "sync");
    // Short enough that an alias would be noise.
    expect(sync.aliases()).toEqual([]);
    expect(sync.commands.map((command) => command.name())).toEqual([
      "providers",
      "add",
      "scopes",
      "configure",
      "list",
      "get",
      "run",
    ]);
  });

  it("splits channels from the items they capture", () => {
    const program = new Command();
    registerSync(program);
    registerMemory(program);

    // `sync get` resolves a channel (SourceConnection); `memory captures get`
    // resolves an ingested item (Source). Splitting them retired the
    // polymorphic `source get` that guessed the entity from a 404.
    const sync = child(program, "sync");
    expect(sync.commands.map((command) => command.name())).toContain("get");
    const captures = child(child(program, "memory"), "captures");
    expect(captures.commands.map((command) => command.name())).toEqual([
      "list",
      "get",
    ]);
  });
});

describe("connector configuration", () => {
  it("accepts a JSON object without interpreting connector fields", () => {
    expect(
      parseConnectorConfig('{"project":"engineering","labels":["bug"]}'),
    ).toEqual({ project: "engineering", labels: ["bug"] });
  });

  it.each(["not-json", "null", "[]", '"text"'])(
    "rejects a non-object value: %s",
    (value) => {
      expect(() => parseConnectorConfig(value)).toThrow(
        /--config must be (valid JSON|a JSON object)/,
      );
    },
  );
});
