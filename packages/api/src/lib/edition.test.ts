import { afterEach, describe, expect, it } from "vitest";

import { isCommunityEdition, nimbaseEdition } from "./edition";

const originalEdition = process.env.NIMBASE_EDITION;

afterEach(() => {
  if (originalEdition === undefined) {
    delete process.env.NIMBASE_EDITION;
  } else {
    process.env.NIMBASE_EDITION = originalEdition;
  }
});

describe("nimbaseEdition", () => {
  it("preserves cloud behavior by default", () => {
    delete process.env.NIMBASE_EDITION;

    expect(nimbaseEdition()).toBe("cloud");
    expect(isCommunityEdition()).toBe(false);
  });

  it("recognizes the community runtime", () => {
    process.env.NIMBASE_EDITION = "community";

    expect(nimbaseEdition()).toBe("community");
    expect(isCommunityEdition()).toBe(true);
  });

  it("rejects misspelled editions instead of silently changing policy", () => {
    process.env.NIMBASE_EDITION = "comunity";

    expect(() => nimbaseEdition()).toThrow("Invalid NIMBASE_EDITION");
  });
});
