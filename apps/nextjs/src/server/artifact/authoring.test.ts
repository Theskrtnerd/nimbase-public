import { beforeEach, describe, expect, it, vi } from "vitest";

// The authoring module reaches the DB through a fluent select chain; stub the
// whole client so the poll loop is exercised against a scripted sequence of
// rows. Shared by both chat-side surfaces (agent tool, group MCP endpoint).
const mocks = vi.hoisted(() => ({
  getObjectText: vi.fn(() => Promise.resolve("<!doctype html><h1>Hi</h1>")),
}));
const rows: {
  status?: string;
  error?: string | null;
  s3KeyHtml?: string | null;
}[] = [];
vi.mock("@acme/runtime/s3", () => ({
  getObjectText: mocks.getObjectText,
}));
vi.mock("@acme/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows.length ? [rows.shift()] : []),
        }),
      }),
    }),
  },
}));
vi.mock("./create-artifact", () => ({ createArtifact: vi.fn() }));

const { createArtifact } = await import("./create-artifact");
const { authorArtifact, waitForArtifact } = await import("./authoring");

// A clock the test drives by hand, so timeout behaviour is deterministic.
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

beforeEach(() => {
  rows.length = 0;
});

describe("waitForArtifact", () => {
  it("returns draft as soon as the artifact is ready", async () => {
    rows.push({ status: "draft", error: null });
    const clock = fakeClock();
    await expect(waitForArtifact("c1", clock)).resolves.toEqual({
      status: "draft",
      error: null,
    });
  });

  it("polls through generating until draft", async () => {
    rows.push(
      { status: "generating", error: null },
      { status: "generating", error: null },
      { status: "draft", error: null },
    );
    const clock = fakeClock();
    await expect(
      waitForArtifact("c1", { ...clock, intervalMs: 1_000 }),
    ).resolves.toEqual({ status: "draft", error: null });
    expect(rows).toHaveLength(0);
  });

  it("surfaces the generator's failure reason", async () => {
    rows.push({ status: "failed", error: "model refused" });
    await expect(waitForArtifact("c1", fakeClock())).resolves.toEqual({
      status: "failed",
      error: "model refused",
    });
  });

  it("gives up at the deadline rather than looping forever", async () => {
    for (let i = 0; i < 50; i++) {
      rows.push({ status: "generating", error: null });
    }
    const result = await waitForArtifact("c1", {
      ...fakeClock(),
      intervalMs: 1_000,
      timeoutMs: 5_000,
    });
    expect(result.status).toBe("timeout");
  });

  it("treats a vanished artifact as a failure, not a hang", async () => {
    const result = await waitForArtifact("gone", fakeClock());
    expect(result.status).toBe("failed");
  });
});

describe("authorArtifact", () => {
  const config = {
    workspaceId: "ws-1",
    targetFolderId: null,
    readScopes: [],
    visibility: "public" as const,
  };

  beforeEach(() => {
    vi.mocked(createArtifact).mockResolvedValue({
      id: "c1",
      title: "Q3 Breakdown",
      url: "https://app.nimbase.ai/s/abc",
    } as Awaited<ReturnType<typeof createArtifact>>);
  });

  it("hands back the link when the artifact lands in time", async () => {
    rows.push({ status: "draft", error: null });
    const result = await authorArtifact("build it", config);
    expect(result).toContain("https://app.nimbase.ai/s/abc");
    expect(result).toContain("Artifact ready");
  });

  // The behaviour that lets the turn stop blocking: /s/<slug> serves a progress
  // page while generating, so a slow build still yields a usable link rather
  // than a dead end the model has to apologise for.
  it("still returns the link when generation outlasts the wait", async () => {
    for (let i = 0; i < 50; i++) {
      rows.push({ status: "generating", error: null });
    }
    // Real timers here (authorArtifact owns its own clock), so give it a budget
    // that expires on the first poll rather than sleeping through the default.
    const result = await authorArtifact("build it", config, {
      waitTimeoutMs: 1,
    });
    expect(result).toContain("https://app.nimbase.ai/s/abc");
    expect(result).not.toContain("error:");
    expect(result).toMatch(/still rendering/i);
  });

  it("reports a real generation failure instead of a link", async () => {
    rows.push({ status: "failed", error: "model refused" });
    const result = await authorArtifact("build it", config);
    expect(result).toContain("error:");
    expect(result).toContain("model refused");
  });

  it("delegates PNG output to an injected renderer adapter", async () => {
    rows.push(
      { status: "draft", error: null },
      { s3KeyHtml: "artifacts/c1.html" },
    );
    const add = vi.fn();
    const render = vi.fn(() => Promise.resolve(Buffer.from("png")));
    const result = await authorArtifact(
      "build it",
      {
        ...config,
        attachments: { add, take: () => [] },
        renderer: { render },
      },
      { output: "png" },
    );

    expect(render).toHaveBeenCalledWith("<!doctype html><h1>Hi</h1>", "png");
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "q3-breakdown.png",
        mimeType: "image/png",
      }),
    );
    expect(result).toContain("PNG is attached");
  });
});
