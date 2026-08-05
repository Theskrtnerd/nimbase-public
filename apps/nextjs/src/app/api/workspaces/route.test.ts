import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  authorizeUserRequest: vi.fn(),
  getUser: vi.fn(),
  createWorkspace: vi.fn(),
}));

vi.mock("~/server/auth/authorize-workspace", () => ({
  authorizeUserRequest: mocks.authorizeUserRequest,
}));
vi.mock("~/server/brain/port", () => ({ brainInitPort: {} }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ users: { getUser: mocks.getUser } }),
}));
vi.mock("@acme/api/workspace-control", () => ({
  createWorkspace: mocks.createWorkspace,
}));

const CREATED = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "acme.example",
  slug: "acme-example",
  description: null,
  website: "https://acme.example",
  brainInitStatus: "pending",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeUserRequest.mockResolvedValue("user_1");
  mocks.getUser.mockResolvedValue({
    fullName: "Ada Lovelace",
    username: "ada",
    primaryEmailAddress: { emailAddress: "ada@acme.example" },
  });
  mocks.createWorkspace.mockResolvedValue(CREATED);
});

function request(body: unknown): Request {
  return new Request("https://app.example/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/workspaces", () => {
  it("creates a website-derived workspace with a temporary domain title", async () => {
    const response = await POST(request({ website: "https://acme.example" }));

    expect(response.status).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledWith({
      input: {
        name: "acme.example",
        website: "https://acme.example",
      },
      creator: {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@acme.example",
      },
      brainInit: {},
      identitySources: { title: "website", description: "website" },
    });
  });

  it("maps explicit title and description onto the workspace record", async () => {
    const response = await POST(
      request({ title: "Acme", description: "Acme builds anvils." }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { name: "Acme", description: "Acme builds anvils." },
        identitySources: { title: "manual", description: "manual" },
      }),
    );
  });

  it("uses explicit fields over website-derived identity", async () => {
    const response = await POST(
      request({
        website: "https://acme.example",
        title: "Acme Incorporated",
        description: "Custom company description.",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          name: "Acme Incorporated",
          description: "Custom company description.",
          website: "https://acme.example",
        },
        identitySources: { title: "manual", description: "manual" },
      }),
    );
  });

  it("keeps the website as the source for unspecified identity fields", async () => {
    const response = await POST(
      request({ website: "https://acme.example", title: "Acme Incorporated" }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        identitySources: { title: "manual", description: "website" },
      }),
    );
  });

  it("rejects incomplete manual identity or an invalid website", async () => {
    for (const body of [
      { title: "Acme" },
      { description: "Acme builds anvils." },
      { website: "ftp://acme.example" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });
});
