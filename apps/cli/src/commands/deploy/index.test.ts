import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerDeploy } from "./index";

describe("deploy command tree", () => {
  it("groups every outbound deployment under deploy", () => {
    const program = new Command();
    registerDeploy(program);

    expect(program.commands.map((command) => command.name())).toEqual([
      "deploy",
    ]);
    const deploy = program.commands[0];
    expect(deploy?.commands.map((command) => command.name())).toEqual([
      "list",
      "agent",
      "artifact",
      "docs",
      "mcp",
    ]);
    expect(
      deploy?.commands
        .find((command) => command.name() === "agent")
        ?.commands.map((command) => command.name()),
    ).toEqual(["create", "list", "get", "remove"]);
    // Artifacts carry the same create/list/get/remove spine as every other
    // deployment noun, plus `access` for share visibility.
    expect(
      deploy?.commands
        .find((command) => command.name() === "artifact")
        ?.commands.map((command) => command.name()),
    ).toEqual(["create", "list", "get", "access", "remove"]);
    // A docs site is published, not just created — it carries an extra verb
    // the other deployment surfaces don't have.
    expect(
      deploy?.commands
        .find((command) => command.name() === "docs")
        ?.commands.map((command) => command.name()),
    ).toEqual(["create", "list", "get", "publish", "remove"]);
    expect(
      deploy?.commands
        .find((command) => command.name() === "mcp")
        ?.commands.map((command) => command.name()),
    ).toEqual(["create", "list", "get", "remove"]);
  });

  it("uses one create interface across every deployment type", () => {
    const program = new Command();
    registerDeploy(program);

    const deploy = program.commands[0];
    for (const type of ["agent", "artifact", "docs", "mcp"]) {
      const create = deploy?.commands
        .find((command) => command.name() === type)
        ?.commands.find((command) => command.name() === "create");

      expect(
        create?.registeredArguments.map((argument) => argument.name()),
      ).toEqual(["prompt"]);
      expect(create?.registeredArguments[0]?.required).toBe(true);
    }
  });

  it("keeps deployment creation free of advanced presentation options", () => {
    const program = new Command();
    registerDeploy(program);

    const deploy = program.commands[0];
    for (const type of ["agent", "artifact", "docs", "mcp"]) {
      const options =
        deploy?.commands
          .find((command) => command.name() === type)
          ?.commands.find((command) => command.name() === "create")
          ?.options.map((option) => option.long) ?? [];

      expect(options).not.toContain("--instructions");
      expect(options).not.toContain("--greeting");
      expect(options).not.toContain("--accent");
      expect(options).not.toContain("--position");
    }
  });

  it("keeps artifact visibility to private or public", () => {
    const program = new Command();
    registerDeploy(program);

    const artifact = program.commands[0]?.commands.find(
      (command) => command.name() === "artifact",
    );
    const create = artifact?.commands.find(
      (command) => command.name() === "create",
    );
    const access = artifact?.commands.find(
      (command) => command.name() === "access",
    );

    expect(create?.options.map((option) => option.long)).not.toContain(
      "--password",
    );
    expect(
      create?.options.find((option) => option.long === "--visibility")
        ?.description,
    ).toBe("private | public");
    expect(access?.registeredArguments[1]?.description).toBe(
      "private | public",
    );
  });
});
