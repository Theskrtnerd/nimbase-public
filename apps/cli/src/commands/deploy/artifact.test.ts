import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerDeployArtifact } from "./artifact";

const mocks = vi.hoisted(() => ({
  printJson: vi.fn(),
  printLine: vi.fn(),
  request: vi.fn(),
  workspaceScope: vi.fn(),
}));

vi.mock("../../output", () => ({
  printJson: mocks.printJson,
  printLine: mocks.printLine,
  renderTable: vi.fn(),
}));
vi.mock("../../workspace", () => ({ workspaceScope: mocks.workspaceScope }));

describe("deploy artifact slug interface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceScope.mockResolvedValue({
      ctx: {
        globals: { json: false },
        client: { request: mocks.request },
      },
      workspaceId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("creates and reports an artifact by slug", async () => {
    mocks.request.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000002",
      slug: "quarterly-review",
      status: "generating",
      url: "https://app.nimbase.ai/s/quarterly-review",
      visibility: "private",
    });
    const program = new Command();
    registerDeployArtifact(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "artifact",
      "create",
      "Quarterly review",
      "--slug",
      "quarterly-review",
    ]);

    const call = mocks.request.mock.calls[0] as unknown as [
      string,
      string,
      { body: { slug?: string } },
    ];
    expect(call[0]).toBe("POST");
    expect(call[1]).toBe("/api/artifacts");
    expect(call[2].body.slug).toBe("quarterly-review");
    expect(mocks.printLine).toHaveBeenCalledWith(
      expect.stringContaining("nimbase deploy artifact get quarterly-review"),
    );
  });

  it("uses the slug for management routes", async () => {
    mocks.request.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000002",
      slug: "quarterly-review",
      status: "draft",
      ready: true,
      url: "https://app.nimbase.ai/s/quarterly-review",
      visibility: "private",
      error: null,
    });
    const program = new Command();
    registerDeployArtifact(program);

    await program.parseAsync([
      "node",
      "nimbase",
      "artifact",
      "get",
      "quarterly-review",
    ]);

    expect(mocks.request).toHaveBeenCalledWith(
      "GET",
      "/api/artifacts/quarterly-review/status",
      expect.any(Object),
    );
  });
});
