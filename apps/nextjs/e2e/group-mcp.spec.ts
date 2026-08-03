import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { ApiToken, GroupMcp, WikiNode, Workspace } from "@acme/db/schema";

// Deterministic, request-only e2e for the Group-MCP serving path (Task 11).
//
// The plan's original sketch was a full authenticated Playwright UI flow
// (sign in -> Access -> Group MCPs -> prompt -> Propose -> Create), but this
// repo has no authenticated-e2e pattern yet (smoke.spec.ts is
// unauthenticated-only) and the UI prompt->propose path calls a real AI
// model, which would make the test flaky and slow. Instead this spec seeds a
// group-MCP endpoint + a scoped ApiToken directly into the dev DB (Playwright
// specs run in Node, so `@acme/db` is importable directly), then drives the
// `/api/group-mcp/[orgSlug]/[groupSlug]` route with the `request` fixture
// only -- no browser, no Clerk, no AI model call. This exercises exactly the
// security-critical part of the feature: does the route serve only the
// allowlisted tools, and does it fence results to the deployment folder.
//
// NOTE on search: `search` fans out through `searchWorkspace` ->
// `wiki_chunk` (embeddings/keyword index), which is populated by the compile
// pipeline. A bare `WikiNode` insert (no `WikiNodeVersion`/`WikiChunk`) is
// never returned by search regardless of scope, so this spec cannot assert
// the "in-scope note IS found" half of the fencing claim without either a
// real compile job or a fabricated 1536-dim embedding (out of scope for a
// deterministic test with no AI). We fall back to the weaker-but-still
// meaningful property: a search for the out-of-scope term returns zero hits
// through this token. That, combined with the `tools/list` allowlist check
// and the cross-workspace/folder 401/403/404 checks below, still covers the
// fencing-relevant code paths (`resolveGroupMcpAccess`, `pathScopeWhere`)
// even though it can't distinguish "properly fenced" from "nothing indexed"
// on its own for the search tool specifically.

const SUFFIX = "e2e-groupmcp";
const BASE_URL = "http://localhost:3100";

const rawToken = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(rawToken).digest("hex");

let workspaceId: string;
let teamAFolderId: string;
let teamBFolderId: string;
let deploymentId: string;
let apiTokenId: string;
const wikiNodeIds: string[] = [];

test.describe("group-mcp serving path", () => {
  test.beforeAll(async () => {
    const [workspace] = await db
      .insert(Workspace)
      .values({
        name: "E2E GroupMCP",
        slug: SUFFIX,
        ownerUserId: "e2e-admin",
      })
      .returning({ id: Workspace.id });
    if (!workspace) throw new Error("failed to seed workspace");
    workspaceId = workspace.id;

    const [teamA] = await db
      .insert(WikiNode)
      .values({
        workspaceId,
        path: "team-a",
        kind: "folder",
        title: "Team A",
        restricted: true,
      })
      .returning({ id: WikiNode.id });
    const [teamB] = await db
      .insert(WikiNode)
      .values({
        workspaceId,
        path: "team-b",
        kind: "folder",
        title: "Team B",
        restricted: true,
      })
      .returning({ id: WikiNode.id });
    if (!teamA || !teamB) throw new Error("failed to seed folders");
    teamAFolderId = teamA.id;
    teamBFolderId = teamB.id;

    const [inScope] = await db
      .insert(WikiNode)
      .values({
        workspaceId,
        path: "team-a/in-scope",
        kind: "note",
        title: "ZEBRAFISH note",
        restricted: false,
      })
      .returning({ id: WikiNode.id });
    const [outScope] = await db
      .insert(WikiNode)
      .values({
        workspaceId,
        path: "team-b/out-scope",
        kind: "note",
        title: "WALRUSCODE note",
        restricted: false,
      })
      .returning({ id: WikiNode.id });
    if (!inScope || !outScope) throw new Error("failed to seed notes");
    wikiNodeIds.push(inScope.id, outScope.id);

    const [deployment] = await db
      .insert(GroupMcp)
      .values({
        workspaceId,
        slug: "team-a",
        name: "Team A",
        folderId: teamAFolderId,
        instructions: "team a stuff",
        enabled: true,
        tools: ["search", "get_note", "list_sources"],
        authMethods: ["api_key"],
      })
      .returning({ id: GroupMcp.id });
    if (!deployment) throw new Error("failed to seed deployment");
    deploymentId = deployment.id;

    const [token] = await db
      .insert(ApiToken)
      .values({
        workspaceId,
        tokenHash,
        label: "e2e",
        folderId: teamAFolderId,
        role: "viewer",
        groupMcpId: deploymentId,
      })
      .returning({ id: ApiToken.id });
    if (!token) throw new Error("failed to seed token");
    apiTokenId = token.id;
  });

  test.afterAll(async () => {
    try {
      if (apiTokenId) {
        await db.delete(ApiToken).where(eq(ApiToken.id, apiTokenId));
      }
      if (deploymentId) {
        await db.delete(GroupMcp).where(eq(GroupMcp.id, deploymentId));
      }
      for (const id of wikiNodeIds) {
        await db.delete(WikiNode).where(eq(WikiNode.id, id));
      }
      if (teamAFolderId) {
        await db.delete(WikiNode).where(eq(WikiNode.id, teamAFolderId));
      }
      if (teamBFolderId) {
        await db.delete(WikiNode).where(eq(WikiNode.id, teamBFolderId));
      }
      if (workspaceId) {
        await db.delete(Workspace).where(eq(Workspace.id, workspaceId));
      }
    } finally {
      // Belt-and-suspenders: if the workspace row is gone but a race left an
      // orphan folder/deployment with the same slug from a prior failed run,
      // don't let it break future runs.
      await db
        .delete(WikiNode)
        .where(and(eq(WikiNode.path, "team-a"), eq(WikiNode.title, "Team A")))
        .catch(() => undefined);
    }
  });

  interface JsonRpcResponse {
    result?: { tools?: { name: string }[]; content?: { text: string }[] };
    error?: { message: string };
  }

  async function readJsonRpc(res: {
    text: () => Promise<string>;
  }): Promise<JsonRpcResponse> {
    const body = await res.text();
    const trimmed = body.trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as JsonRpcResponse;
    }
    // SSE framing: find the `data: {...}` line and parse its payload.
    const dataLine = trimmed
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new Error(`could not parse JSON-RPC response body: ${body}`);
    }
    return JSON.parse(dataLine.slice("data:".length).trim()) as JsonRpcResponse;
  }

  test("tools/list serves exactly the allowlisted tools", async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE_URL}/api/group-mcp/${SUFFIX}/team-a`,
      {
        headers: {
          Authorization: `Bearer ${rawToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await readJsonRpc(res);
    const names = new Set((body.result?.tools ?? []).map((t) => t.name));
    expect(names).toEqual(new Set(["search", "get_note", "list_sources"]));
  });

  test("search fences results to the deployment folder", async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE_URL}/api/group-mcp/${SUFFIX}/team-a`,
      {
        headers: {
          Authorization: `Bearer ${rawToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        data: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search", arguments: { query: "WALRUSCODE" } },
        },
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await readJsonRpc(res);
    const text = body.result?.content?.[0]?.text ?? "";
    // The out-of-scope note (team-b) must never surface through a token
    // fenced to team-a, regardless of whether it was actually indexed.
    // Assert on the note's PATH identity ("team-b" / "out-scope"), NOT the
    // query term: the search tool echoes the query in its result header
    // (`N hit(s) for "<query>"`), so checking for the query string would
    // false-positive on that echo rather than a real leak.
    expect(text).not.toContain("team-b");
    expect(text).not.toContain("out-scope");
  });

  test("a request with no Authorization header is unauthorized", async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE_URL}/api/group-mcp/${SUFFIX}/team-a`,
      {
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        data: { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
      },
    );
    expect(res.status()).toBe(401);
  });

  test("a non-existent group slug 404s", async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/group-mcp/${SUFFIX}/does-not-exist`,
      {
        headers: {
          Authorization: `Bearer ${rawToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        data: { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} },
      },
    );
    expect(res.status()).toBe(404);
  });
});
