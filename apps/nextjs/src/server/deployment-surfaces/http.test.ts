import { beforeEach, describe, expect, it, vi } from "vitest";

import { mcpDeploymentResponse } from "./http";

const mocks = vi.hoisted(() => ({
  workspaceSlug: vi.fn(),
}));

vi.mock("@acme/api/deployment-surfaces-control", () => ({
  DeploymentSurfaceError: class extends Error {},
  workspaceSlug: mocks.workspaceSlug,
}));
vi.mock("@acme/api/entitlements", () => ({
  EntitlementError: class extends Error {},
}));
vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_APP_HOST: "nimbase.ai" },
}));
vi.mock("~/server/auth/authorize-workspace", () => ({
  authorizeWorkspaceRequest: vi.fn(),
  authzErrorResponse: vi.fn(
    () => new Response(null, { status: 401 }) as unknown,
  ),
}));

const MCP_DEPLOYMENT = {
  slug: "customer-support",
  name: "Customer Support",
  instructions: "Approved customer knowledge only.",
  folderPath: "customer-support",
  enabled: true,
  tools: ["search", "get_note", "list_sources"] as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceSlug.mockResolvedValue("acme");
});

describe("deployment surface wire responses", () => {
  it("uses the direct local MCP route during development", async () => {
    const result = await mcpDeploymentResponse(
      new Request("http://localhost:3100/api/deployments/mcp"),
      "workspace-id",
      { ...MCP_DEPLOYMENT, tools: [...MCP_DEPLOYMENT.tools] },
    );

    expect(result.url).toBe(
      "http://localhost:3100/api/group-mcp/acme/customer-support",
    );
    expect(result.authMethods).toEqual(["oauth"]);
  });

  it("uses the dedicated MCP hostname in production", async () => {
    const result = await mcpDeploymentResponse(
      new Request("https://app.nimbase.ai/api/deployments/mcp"),
      "workspace-id",
      { ...MCP_DEPLOYMENT, tools: [...MCP_DEPLOYMENT.tools] },
    );

    expect(result.url).toBe("https://mcp.nimbase.ai/acme/customer-support/mcp");
  });
});
