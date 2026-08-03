import { describe, expect, it } from "vitest";

import { buildProgram } from "./program";

describe("public command tree", () => {
  it("replaces the admin namespace with workspace plan", () => {
    const program = buildProgram();
    const workspace = program.commands.find(
      (command) => command.name() === "workspace",
    );

    expect(program.commands.map((command) => command.name())).not.toContain(
      "admin",
    );
    expect(workspace?.commands.map((command) => command.name())).toContain(
      "plan",
    );
  });

  it("keeps pagination out of list command options", () => {
    const program = buildProgram();
    const deploy = program.commands.find(
      (command) => command.name() === "deploy",
    );
    const memory = program.commands.find(
      (command) => command.name() === "memory",
    );
    const artifact = deploy?.commands.find(
      (command) => command.name() === "artifact",
    );
    const captures = memory?.commands.find(
      (command) => command.name() === "captures",
    );
    const listCommands = [
      deploy?.commands.find((command) => command.name() === "list"),
      artifact?.commands.find((command) => command.name() === "list"),
      captures?.commands.find((command) => command.name() === "list"),
    ];

    for (const command of listCommands) {
      expect(command).toBeDefined();
      const options = command?.options.map((option) => option.long) ?? [];
      for (const paginationOption of ["--limit", "--cursor", "--all"]) {
        expect(options).not.toContain(paginationOption);
      }
    }
  });
});
