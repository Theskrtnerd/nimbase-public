import { afterEach, beforeEach, expect, it, vi } from "vitest";

const publishJSON = vi.fn();
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn(() => ({ publishJSON })),
}));

const data = { jobId: "j1", workspaceId: "w1", sourceId: "s1" };

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Fresh module per test so the internal `qstashClient` singleton is reset.
  vi.resetModules();
  vi.clearAllMocks();
  process.env.QSTASH_TOKEN = "tok";
  process.env.NIMBASE_WEB_URL = "https://app.example.com";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

it("publishes to /api/compile with dedup id, retries, and per-workspace flow control", async () => {
  const { publishCompile } = await import("./queue");
  await publishCompile(data);
  expect(publishJSON).toHaveBeenCalledWith({
    url: "https://app.example.com/api/compile",
    body: data,
    deduplicationId: "j1",
    retries: 3,
    flowControl: { key: "compile-w1", parallelism: 1 },
  });
});

it("publishes memory Git projection with per-workspace serialization", async () => {
  const { publishMemoryGitProjection } = await import("./queue");
  const projection = { jobId: "m1", workspaceId: "w1" };
  await publishMemoryGitProjection(projection);
  expect(publishJSON).toHaveBeenCalledWith({
    url: "https://app.example.com/api/memory/git/project",
    body: projection,
    deduplicationId: "memory-git-m1",
    retries: 3,
    flowControl: { key: "memory-git-w1", parallelism: 1 },
  });
});

it("throws when NIMBASE_WEB_URL is unset", async () => {
  delete process.env.NIMBASE_WEB_URL;
  const { publishCompile } = await import("./queue");
  await expect(publishCompile(data)).rejects.toThrow("NIMBASE_WEB_URL");
});

it("throws when QSTASH_TOKEN is unset", async () => {
  delete process.env.QSTASH_TOKEN;
  const { publishCompile } = await import("./queue");
  await expect(publishCompile(data)).rejects.toThrow("QSTASH_TOKEN");
});
