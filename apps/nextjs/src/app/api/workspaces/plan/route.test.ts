import { beforeEach, describe, expect, it, vi } from "vitest";

import { workspacePlanSetResponseSchema } from "@acme/validators/cli";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  authorizeUserRequest: vi.fn(),
  authorizeWorkspaceRequest: vi.fn(),
  getUser: vi.fn(),
  isGod: vi.fn(),
  setPlanOverride: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  isCommunityEdition: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ users: { getUser: mocks.getUser } }),
}));
vi.mock("@acme/api/operator", () => ({ isGod: mocks.isGod }));
vi.mock("@acme/api/edition", () => ({
  isCommunityEdition: mocks.isCommunityEdition,
}));
vi.mock("@acme/api/plan-override", () => ({
  setPlanOverride: mocks.setPlanOverride,
}));
vi.mock("@acme/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ limit: mocks.limit }),
        }),
      }),
    }),
  },
}));
vi.mock("~/server/auth/authorize-workspace", () => ({
  authorizeUserRequest: mocks.authorizeUserRequest,
  authorizeWorkspaceRequest: mocks.authorizeWorkspaceRequest,
  authzErrorResponse: () =>
    Response.json({ error: "unauthorized" }, { status: 401 }),
}));
vi.mock("~/server/billing/stripe", () => ({
  createCheckoutSession: mocks.createCheckoutSession,
  createPortalSession: mocks.createPortalSession,
}));

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const OWNER_ACCESS = {
  ok: true,
  workspaceId: WORKSPACE_ID,
  userId: "user-1",
  access: { role: "owner" },
};

function planRequest(plan: string): Request {
  return new Request("https://app.test/api/workspaces/plan", {
    method: "POST",
    body: JSON.stringify({ workspaceId: WORKSPACE_ID, plan }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeUserRequest.mockResolvedValue("user-1");
  mocks.authorizeWorkspaceRequest.mockResolvedValue(OWNER_ACCESS);
  mocks.getUser.mockResolvedValue({
    primaryEmailAddress: { emailAddress: "owner@acme.test" },
  });
  mocks.isGod.mockReturnValue(false);
  mocks.isCommunityEdition.mockReturnValue(false);
  mocks.limit.mockResolvedValue([
    {
      id: WORKSPACE_ID,
      plan: null,
      status: null,
      stripeSubscriptionId: null,
    },
  ]);
  mocks.setPlanOverride.mockResolvedValue({
    plan: "enterprise",
    status: null,
  });
  mocks.createCheckoutSession.mockResolvedValue({
    url: "https://checkout.stripe.test/session",
  });
  mocks.createPortalSession.mockResolvedValue({
    url: "https://billing.stripe.test/session",
  });
});

describe("POST /api/workspaces/plan", () => {
  it("keeps community workspaces unlocked without calling Clerk or Stripe", async () => {
    mocks.isCommunityEdition.mockReturnValue(true);

    const response = await POST(planRequest("pro"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "unchanged",
      plan: "enterprise",
    });
    expect(mocks.authorizeWorkspaceRequest).toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.createPortalSession).not.toHaveBeenCalled();
  });

  it("rejects automation credentials before billing or override logic", async () => {
    mocks.authorizeUserRequest.mockResolvedValue(null);

    const response = await POST(planRequest("pro"));

    expect(response.status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.setPlanOverride).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("gives a normal workspace owner Stripe Checkout for Pro", async () => {
    const response = await POST(planRequest("pro"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "checkout",
      plan: "pro",
      url: "https://checkout.stripe.test/session",
    });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userId: "user-1",
      baseUrl: "https://app.test",
    });
    expect(mocks.setPlanOverride).not.toHaveBeenCalled();
    expect(mocks.createPortalSession).not.toHaveBeenCalled();
  });

  it("applies a direct audited override for Nimbase staff", async () => {
    mocks.isGod.mockReturnValue(true);

    const response = await POST(planRequest("enterprise"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "override",
      plan: "enterprise",
      status: null,
      warning: null,
    });
    expect(mocks.setPlanOverride).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      plan: "enterprise",
      operatorUserId: "user-1",
    });
    expect(mocks.authorizeWorkspaceRequest).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("warns staff before Stripe can overwrite a direct override", async () => {
    mocks.isGod.mockReturnValue(true);
    mocks.limit.mockResolvedValue([
      {
        id: WORKSPACE_ID,
        plan: "pro",
        status: "past_due",
        stripeSubscriptionId: "sub_1",
      },
    ]);

    const response = await POST(planRequest("enterprise"));

    expect(response.status).toBe(200);
    const body = workspacePlanSetResponseSchema.parse(await response.json());
    expect(body.action).toBe("override");
    if (body.action !== "override") throw new Error("Expected override");
    expect(body.plan).toBe("enterprise");
    expect(body.warning).toContain("Stripe webhook");
  });

  it("does nothing when the requested plan is already effective", async () => {
    mocks.limit.mockResolvedValue([
      {
        id: WORKSPACE_ID,
        plan: "pro",
        status: "active",
        stripeSubscriptionId: "sub_1",
      },
    ]);

    const response = await POST(planRequest("pro"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "unchanged",
      plan: "pro",
    });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.createPortalSession).not.toHaveBeenCalled();
  });

  it("uses Portal instead of duplicate Checkout for a live subscription", async () => {
    mocks.limit.mockResolvedValue([
      {
        id: WORKSPACE_ID,
        plan: "pro",
        status: "unpaid",
        stripeSubscriptionId: "sub_1",
      },
    ]);

    const response = await POST(planRequest("pro"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "portal",
      plan: "pro",
      url: "https://billing.stripe.test/session",
    });
    expect(mocks.createPortalSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      baseUrl: "https://app.test",
    });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("keeps self-service plan changes owner-only", async () => {
    mocks.authorizeWorkspaceRequest.mockResolvedValue({
      ...OWNER_ACCESS,
      access: { role: "member" },
    });

    const response = await POST(planRequest("pro"));

    expect(response.status).toBe(403);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("routes Enterprise requests to sales without touching Stripe", async () => {
    const response = await POST(planRequest("enterprise"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "contact",
      plan: "enterprise",
      reason: "enterprise_sales",
    });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.createPortalSession).not.toHaveBeenCalled();
  });
});
