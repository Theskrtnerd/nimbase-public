import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, it } from "vitest";

import { configPath, loadConfig, readConfig, saveConfig } from "./config";

beforeEach(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), "nimbase-"));
});

function writeRawConfig(contents: string): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

it("returns an empty config when the file is missing", async () => {
  expect(await loadConfig()).toEqual({});
});

// A missing file is the ordinary pre-login state, so it must not be reported as
// a problem — otherwise `doctor` would cry wolf at every new install.
it("reports no problem for a missing config", async () => {
  expect(await readConfig()).toEqual({ config: {}, problem: null });
});

/**
 * The gap this closes: an unparseable config silently fell back to `{}`, so
 * every command said "not authenticated" and nothing anywhere told the user
 * their config file was corrupt.
 */
it.each([
  ["truncated json", "{not json"],
  ["a bare array", "[]"],
  ["a bare string", '"nope"'],
  ["null", "null"],
])("flags %s as malformed", async (_label, contents) => {
  writeRawConfig(contents);
  expect(await readConfig()).toEqual({ config: {}, problem: "malformed" });
  // The front door still degrades to an empty config, so callers are unchanged.
  expect(await loadConfig()).toEqual({});
});

it("reports no problem for a config that parses", async () => {
  writeRawConfig("{not json");
  expect((await readConfig()).problem).toBe("malformed");

  await saveConfig({ sessionToken: "t" });
  expect((await readConfig()).problem).toBeNull();
});

it("round-trips config and writes the file with mode 0600", async () => {
  await saveConfig({ sessionToken: "t", defaultWorkspaceId: "w" });
  expect(await loadConfig()).toMatchObject({
    sessionToken: "t",
    defaultWorkspaceId: "w",
  });
  const mode = (await stat(configPath())).mode & 0o777;
  expect(mode).toBe(0o600);
});
