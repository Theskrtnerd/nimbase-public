import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  acceptPendingInvites: vi.fn(),
  getUser: vi.fn(),
  issueSessionToken: vi.fn(),
  redeemAuthCode: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ users: { getUser: mocks.getUser } }),
}));
vi.mock("~/lib/desktop-auth", () => ({
  issueSessionToken: mocks.issueSessionToken,
  redeemAuthCode: mocks.redeemAuthCode,
}));
vi.mock("~/server/auth/accept-invites", () => ({
  acceptPendingInvites: mocks.acceptPendingInvites,
}));

const user = {
  id: "user_1",
  fullName: "Ada Lovelace",
  username: "ada",
  primaryEmailAddress: { emailAddress: "ada@example.com" },
  emailAddresses: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redeemAuthCode.mockReturnValue({ userId: "user_1" });
  mocks.getUser.mockResolvedValue(user);
  mocks.acceptPendingInvites.mockResolvedValue(0);
  mocks.issueSessionToken.mockReturnValue({
    token: "session-token",
    expiresAt: 1234,
  });
});

function request(body: unknown): Request {
  return new Request("https://app.example/api/extension/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/extension/token", () => {
  it("accepts pending invitations before completing CLI login", async () => {
    const response = await POST(
      request({ code: "auth-code", codeVerifier: "v".repeat(32) }),
    );

    expect(response.status).toBe(200);
    expect(mocks.acceptPendingInvites).toHaveBeenCalledWith(user);
    await expect(response.json()).resolves.toMatchObject({
      token: "session-token",
      user: { id: "user_1", email: "ada@example.com" },
    });
  });

  it("rejects an invalid authorization grant", async () => {
    mocks.redeemAuthCode.mockReturnValue(null);

    const response = await POST(
      request({ code: "auth-code", codeVerifier: "v".repeat(32) }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.acceptPendingInvites).not.toHaveBeenCalled();
  });
});
