import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// NOT-77: the harness runtime is meant to lift out of @acme/runtime into
// @acme/agents. It cannot while its modules import back into cloud, because
// cloud already depends on @acme/agents — that is a package cycle, not a
// refactor inconvenience.
//
// ./bindings.ts is the sanctioned exception: it exists precisely to hold those
// imports, so the eventual move rewrites one file. ./index.ts is the public
// barrel and re-exports from it.
const CLOUD_FACING = ["./bindings.ts", "./index.ts"];

// The imports that create the cycle. Deliberately narrow: harness modules also
// import ../memory/wiki/* (the VFS), which is a separate and harder problem —
// vfs.ts is the Postgres storage implementation and is not moving. Widening
// this list is a decision, not a cleanup.
const FORBIDDEN = [
  /from "\.\.\/search"/,
  /from "\.\.\/env"/,
  /from "\.\.\/ai\//,
];

const dir = new URL(".", import.meta.url).pathname;

function harnessSources(): string[] {
  return readdirSync(dir).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      !CLOUD_FACING.includes(`./${f}`),
  );
}

describe("harness runtime purity", () => {
  it("keeps every module except the bindings free of cloud imports", () => {
    const offenders: string[] = [];
    for (const file of harnessSources()) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(src)) offenders.push(`${file} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still has the bindings module actually doing the binding", () => {
    // Guards the inverse mistake: satisfying the rule above by dropping the
    // capability rather than injecting it.
    const src = readFileSync(join(dir, "bindings.ts"), "utf8");
    expect(src).toContain('from "../search"');
    expect(src).toContain('from "../ai/config"');
    expect(src).toContain('from "../env"');
  });
});
