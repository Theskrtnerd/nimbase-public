import { afterEach, expect, it, vi } from "vitest";

import { dispatchCompile, runCompileJob } from "./dispatch";

const mocks = vi.hoisted(() => ({
  qstashToken: undefined as string | undefined,
  publishCompile: vi.fn(),
  processCompileJob: vi.fn(),
}));

vi.mock("~/env", () => ({
  env: {
    get QSTASH_TOKEN() {
      return mocks.qstashToken;
    },
  },
}));
vi.mock("@acme/runtime/queue", () => ({
  publishCompile: mocks.publishCompile,
}));
vi.mock("./process", () => ({ processCompileJob: mocks.processCompileJob }));

const data = { jobId: "j1", workspaceId: "w1", sourceId: "s1" };

afterEach(() => {
  vi.clearAllMocks();
  mocks.qstashToken = undefined;
});

it("publishes via QStash when QSTASH_TOKEN is set", async () => {
  mocks.qstashToken = "tok";
  await dispatchCompile(data);
  expect(mocks.publishCompile).toHaveBeenCalledWith(data);
  expect(mocks.processCompileJob).not.toHaveBeenCalled();
});

it("runs inline when QSTASH_TOKEN is unset", async () => {
  await dispatchCompile(data);
  expect(mocks.processCompileJob).toHaveBeenCalledWith(data);
  expect(mocks.publishCompile).not.toHaveBeenCalled();
});

it("swallows inline compile failures so the caller isn't 500'd", async () => {
  mocks.processCompileJob.mockRejectedValueOnce(new Error("compile boom"));
  await expect(dispatchCompile(data)).resolves.toBeUndefined();
});

it("runs exactly one canonical compile job", async () => {
  await runCompileJob(data);
  expect(mocks.processCompileJob).toHaveBeenCalledTimes(1);
  expect(mocks.processCompileJob).toHaveBeenCalledWith(data);
});
