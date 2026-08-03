import { afterEach, describe, expect, it } from "vitest";

import { harnessEnabledFor } from "./flags";

describe("harnessEnabledFor", () => {
  afterEach(() => {
    delete process.env.NIMBASE_HARNESS_SURFACES;
  });

  it("is off for every surface when unset or empty", () => {
    expect(harnessEnabledFor("gardener")).toBe(false);
    process.env.NIMBASE_HARNESS_SURFACES = "";
    expect(harnessEnabledFor("artifact")).toBe(false);
  });

  it("matches listed surfaces, tolerating spaces and extras", () => {
    process.env.NIMBASE_HARNESS_SURFACES = " artifact, gardener ,unknown";
    expect(harnessEnabledFor("artifact")).toBe(true);
    expect(harnessEnabledFor("gardener")).toBe(true);
    expect(harnessEnabledFor("chat")).toBe(false);
  });

  it("re-reads the env on every call", () => {
    expect(harnessEnabledFor("chat")).toBe(false);
    process.env.NIMBASE_HARNESS_SURFACES = "chat";
    expect(harnessEnabledFor("chat")).toBe(true);
  });
});
