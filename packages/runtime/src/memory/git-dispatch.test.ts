import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("../queue", () => ({
  publishMemoryGitProjection: mocks.publish,
}));
vi.mock("./git-history", () => ({
  projectPendingMemoryHistory: mocks.project,
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publish.mockResolvedValue(undefined);
  mocks.project.mockResolvedValue(0);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

it("queues projection in production", async () => {
  process.env.QSTASH_TOKEN = "token";
  const { notifyMemoryGitProjection } = await import("./git-dispatch");
  await notifyMemoryGitProjection({ mutationId: "m1", workspaceId: "w1" });
  expect(mocks.publish).toHaveBeenCalledWith({
    jobId: "m1",
    workspaceId: "w1",
  });
  expect(mocks.project).not.toHaveBeenCalled();
});

it("projects inline in development and as a queue failure fallback", async () => {
  const { notifyMemoryGitProjection } = await import("./git-dispatch");
  delete process.env.QSTASH_TOKEN;
  await notifyMemoryGitProjection({ mutationId: "m1", workspaceId: "w1" });
  expect(mocks.project).toHaveBeenCalledWith("w1");

  vi.clearAllMocks();
  process.env.QSTASH_TOKEN = "token";
  mocks.publish.mockRejectedValue(new Error("queue down"));
  await notifyMemoryGitProjection({ mutationId: "m2", workspaceId: "w1" });
  expect(mocks.project).toHaveBeenCalledWith("w1");
});
