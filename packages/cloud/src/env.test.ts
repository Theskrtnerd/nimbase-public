import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A complete set of the vars cloudEnv() validates.
const FULL_ENV = {
  AI_GATEWAY_API_KEY: "gw-key",
  NIMBASE_S3_BUCKET: "bucket",
  NIMBASE_S3_REGION: "us-east-1",
  NIMBASE_AWS_ACCESS_KEY_ID: "access-key",
  NIMBASE_AWS_SECRET_ACCESS_KEY: "secret-key",
};

describe("cloudEnv", () => {
  const original = process.env;

  beforeEach(() => {
    // Fresh module per test so the internal `cached` value is reset.
    vi.resetModules();
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = original;
  });

  it("parses when all required vars are present", async () => {
    Object.assign(process.env, FULL_ENV);
    const { cloudEnv } = await import("./env");
    expect(cloudEnv().NIMBASE_S3_BUCKET).toBe("bucket");
    expect(cloudEnv().AI_GATEWAY_API_KEY).toBe("gw-key");
  });

  it("throws when a required var is missing", async () => {
    Object.assign(process.env, FULL_ENV);
    delete process.env.NIMBASE_S3_BUCKET;
    const { cloudEnv } = await import("./env");
    expect(() => cloudEnv()).toThrow();
  });

  it("supports an S3-compatible object store", async () => {
    Object.assign(process.env, FULL_ENV, {
      NIMBASE_S3_ENDPOINT: "http://localhost:9000",
      NIMBASE_S3_FORCE_PATH_STYLE: "true",
    });
    const { cloudEnv } = await import("./env");

    expect(cloudEnv()).toMatchObject({
      NIMBASE_S3_ENDPOINT: "http://localhost:9000",
      NIMBASE_S3_FORCE_PATH_STYLE: true,
    });
  });

  it("caches the parsed result after the first call", async () => {
    Object.assign(process.env, FULL_ENV);
    const { cloudEnv } = await import("./env");
    const first = cloudEnv();
    // A later env mutation must not be re-read — the value is cached.
    process.env.NIMBASE_S3_BUCKET = "changed-bucket";
    expect(cloudEnv()).toBe(first);
    expect(cloudEnv().NIMBASE_S3_BUCKET).toBe("bucket");
  });
});
