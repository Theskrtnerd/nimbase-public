import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessContext } from "@acme/api/access";

vi.mock("~/server/kb/get-note", () => ({
  getNoteForAccess: vi.fn(),
}));
vi.mock("~/server/kb/list-sources", () => ({
  listSourcesForAccess: vi.fn(),
}));
vi.mock("~/server/artifact/authoring", () => ({
  authorArtifact: vi.fn(),
  CREATE_ARTIFACT_DESCRIPTION: "create artifact",
  CREATE_ARTIFACT_PROMPT_DESCRIPTION: "prompt",
}));
vi.mock("~/server/ingest/ingest-source", () => ({
  ingestSource: vi.fn(),
}));
vi.mock("~/server/mcp/result", () => ({
  jsonResult: vi.fn(),
  errorResult: vi.fn(),
  toErrorMessage: vi.fn(),
}));
vi.mock("@acme/cloud", () => ({
  toProviderContext: vi.fn(),
  toSearchHit: vi.fn(),
}));
vi.mock("@acme/cloud/memory/wiki-pg-provider", () => ({
  memoryProvider: { search: vi.fn() },
}));

const { registerGroupMcpTools } = await import("./tools");
const { ingestSource } = await import("~/server/ingest/ingest-source");
const { authorArtifact } = await import("~/server/artifact/authoring");
const { errorResult } = await import("~/server/mcp/result");

type Handler = (args: never, extra: unknown) => Promise<unknown>;

function fakeServer() {
  const names: string[] = [];
  const handlers = new Map<string, Handler>();
  return {
    names,
    handlers,
    tool: (
      name: string,
      _description: string,
      _shape: Record<string, unknown>,
      handler: Handler,
    ) => {
      names.push(name);
      handlers.set(name, handler);
    },
  };
}

const access = { workspaceId: "ws-1" } as AccessContext;

// The endpoint's own folder. `restricted` deliberately holds OTHER restricted
// paths. Reading `restricted[0]` to find the anchor is the bug these tests pin
// down.
const GROUP_FOLDER_ID = "folder-group";
const GROUP_FOLDER_PATH = "teams/acme";

function writableAccess(): AccessContext {
  return {
    workspaceId: "ws-1",
    userId: "user-1",
    restricted: ["some/other/restricted/folder", GROUP_FOLDER_PATH],
    canCapture: (path: string) => path === GROUP_FOLDER_PATH,
    scopes: () => [{ prefix: GROUP_FOLDER_PATH, exclude: [] }],
  } as unknown as AccessContext;
}

const options = {
  folderId: GROUP_FOLDER_ID,
  folderPath: GROUP_FOLDER_PATH,
  artifactVisibility: "private" as const,
};

describe("registerGroupMcpTools", () => {
  it("registers exactly the allowlisted tools", () => {
    const s = fakeServer();
    registerGroupMcpTools(
      s as never,
      () => access,
      ["search", "get_note"],
      options,
    );
    expect(s.names.sort()).toEqual(["get_note", "search"]);
  });
  it("registers capture only when allowed", () => {
    const s = fakeServer();
    registerGroupMcpTools(
      s as never,
      () => access,
      ["search", "capture"],
      options,
    );
    expect(s.names).toContain("capture");
  });
  it("registers create_artifact only when allowlisted", () => {
    const s = fakeServer();
    registerGroupMcpTools(s as never, () => access, ["search"], options);
    expect(s.names).not.toContain("create_artifact");

    const t = fakeServer();
    registerGroupMcpTools(
      t as never,
      () => access,
      ["search", "create_artifact"],
      options,
    );
    expect(t.names).toContain("create_artifact");
  });
});

// Regression: these tools used to locate the write anchor with
// `access.restricted[0]`, believing a fenced context carries exactly one path.
// The workspace-wide restricted list may contain unrelated folders, so the
// anchor resolved incorrectly and canCapture denied every write. The anchor is
// endpoint config now, so these assert it is used verbatim.
describe("group write tools anchor to the endpoint folder", () => {
  // These cases assert on call counts, so the shared module mocks must not
  // carry a previous case's invocation over.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures into the endpoint's folder, not access.restricted[0]", async () => {
    const s = fakeServer();
    const caller = writableAccess();
    registerGroupMcpTools(s as never, () => caller, ["capture"], options);

    await s.handlers.get("capture")?.(
      { kind: "web", title: "t", text: "body" } as never,
      {},
    );

    expect(ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "web", title: "t", text: "body" }),
      expect.objectContaining({
        workspaceId: "ws-1",
        targetFolderId: GROUP_FOLDER_ID,
      }),
    );
    expect(errorResult).not.toHaveBeenCalled();
  });

  it("anchors an authored artifact to the endpoint's folder", async () => {
    const s = fakeServer();
    const caller = writableAccess();
    registerGroupMcpTools(
      s as never,
      () => caller,
      ["create_artifact"],
      options,
    );

    await s.handlers.get("create_artifact")?.(
      { prompt: "kpi breakdown" } as never,
      {},
    );

    expect(authorArtifact).toHaveBeenCalledWith(
      "kpi breakdown",
      expect.objectContaining({
        workspaceId: "ws-1",
        targetFolderId: GROUP_FOLDER_ID,
        readScopes: [{ prefix: GROUP_FOLDER_PATH, exclude: [] }],
        visibility: "private",
      }),
    );
  });

  it("denies a caller without capture rights at the anchor", async () => {
    const s = fakeServer();
    const readOnly = {
      workspaceId: "ws-1",
      userId: "user-1",
      restricted: [GROUP_FOLDER_PATH],
      canCapture: () => false,
    } as unknown as AccessContext;
    registerGroupMcpTools(s as never, () => readOnly, ["capture"], options);

    await s.handlers.get("capture")?.({ kind: "web" } as never, {});

    expect(ingestSource).not.toHaveBeenCalled();
    expect(errorResult).toHaveBeenCalled();
  });
});
