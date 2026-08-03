import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerDeployList } from "./list";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  requireSession: vi.fn(),
  resolveWorkspace: vi.fn(),
  printJson: vi.fn(),
  printLine: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../../context", () => ({ createContext: mocks.createContext }));
vi.mock("../../credentials", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("../../workspace", () => ({
  resolveWorkspace: mocks.resolveWorkspace,
}));
vi.mock("../../output", () => ({
  printJson: mocks.printJson,
  printLine: mocks.printLine,
  renderTable: vi.fn(),
}));

describe("deploy list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createContext.mockResolvedValue({
      config: {},
      globals: { json: true },
      client: { request: mocks.request },
    });
    mocks.resolveWorkspace.mockResolvedValue("workspace-id");
    mocks.request.mockImplementation(
      (_: string, path: string, options?: { query?: { cursor?: string } }) => {
        if (path === "/api/artifacts") {
          return Promise.resolve(
            options?.query?.cursor
              ? {
                  artifacts: [
                    { id: "artifact-2", slug: "second", title: "Second" },
                  ],
                  nextCursor: null,
                }
              : {
                  artifacts: [
                    { id: "artifact-1", slug: "first", title: "First" },
                  ],
                  nextCursor: "next-page",
                },
          );
        }
        if (path === "/api/deployments") {
          return Promise.resolve({
            deployments: [
              {
                slug: "support",
                name: "Support",
                enabled: true,
                targetPath: "/",
                targets: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        return Promise.resolve({ deployments: [] });
      },
    );
  });

  it("returns every deployment type with agent interfaces consolidated", async () => {
    const program = new Command().option("--json");
    registerDeployList(program);

    await program.parseAsync(["node", "nimbase", "--json", "list"]);

    expect(mocks.request).toHaveBeenCalledTimes(5);
    expect(mocks.printJson).toHaveBeenCalledWith({
      deployments: [
        expect.objectContaining({
          type: "agent",
          slug: "support",
          ref: "agent:support",
        }),
        expect.objectContaining({
          type: "artifact",
          id: "artifact-1",
          ref: "artifact:first",
        }),
        expect.objectContaining({
          type: "artifact",
          id: "artifact-2",
          ref: "artifact:second",
        }),
      ],
    });
  });
});
