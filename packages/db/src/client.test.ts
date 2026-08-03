import { afterEach, describe, expect, it } from "vitest";

import { databaseDriver } from "./client";

const originalDriver = process.env.NIMBASE_DATABASE_DRIVER;

afterEach(() => {
  if (originalDriver === undefined) {
    delete process.env.NIMBASE_DATABASE_DRIVER;
  } else {
    process.env.NIMBASE_DATABASE_DRIVER = originalDriver;
  }
});

describe("databaseDriver", () => {
  it("preserves Neon as the hosted default", () => {
    delete process.env.NIMBASE_DATABASE_DRIVER;
    expect(databaseDriver()).toBe("neon");
  });

  it("selects standard Postgres for self-hosting", () => {
    process.env.NIMBASE_DATABASE_DRIVER = "postgres";
    expect(databaseDriver()).toBe("postgres");
  });

  it("rejects an unknown driver", () => {
    process.env.NIMBASE_DATABASE_DRIVER = "sqlite";
    expect(() => databaseDriver()).toThrow("Invalid NIMBASE_DATABASE_DRIVER");
  });
});
