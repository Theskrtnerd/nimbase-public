import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerWorkspacePlan } from "./plan";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  requireSession: vi.fn(),
  resolveWorkspace: vi.fn(),
  openBrowser: vi.fn(),
  printJson: vi.fn(),
  printLine: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../../browser", () => ({ openBrowser: mocks.openBrowser }));
vi.mock("../../context", () => ({ createContext: mocks.createContext }));
vi.mock("../../credentials", () => ({ requireSession: mocks.requireSession }));
vi.mock("../../workspace", () => ({
  resolveWorkspace: mocks.resolveWorkspace,
}));
vi.mock("../../output", () => ({
  printJson: mocks.printJson,
  printLine: mocks.printLine,
}));

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

describe("workspace plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createContext.mockResolvedValue({
      config: {},
      globals: { json: false },
      client: { request: mocks.request },
    });
    mocks.resolveWorkspace.mockResolvedValue(WORKSPACE_ID);
    mocks.request.mockResolvedValue({
      action: "checkout",
      plan: "pro",
      url: "https://checkout.stripe.test/session",
    });
  });

  it("is a visible workspace command", () => {
    const program = new Command();
    registerWorkspacePlan(program);

    const plan = program.commands.find((command) => command.name() === "plan");
    expect(plan).toBeDefined();
    expect(
      plan?.registeredArguments.map((argument) => argument.name()),
    ).toEqual(["plan"]);
    expect(program.helpInformation()).toContain("plan");
  });

  it("opens Stripe Checkout for a self-service upgrade", async () => {
    const program = new Command();
    registerWorkspacePlan(program);

    await program.parseAsync(["node", "nimbase", "plan", "pro"]);

    expect(mocks.request).toHaveBeenCalledWith(
      "POST",
      "/api/workspaces/plan",
      expect.objectContaining({
        body: { workspaceId: WORKSPACE_ID, plan: "pro" },
      }),
    );
    expect(mocks.openBrowser).toHaveBeenCalledWith(
      "https://checkout.stripe.test/session",
    );
    expect(mocks.printLine).toHaveBeenCalledWith(
      "https://checkout.stripe.test/session",
    );
  });

  it("can print Checkout without opening a browser", async () => {
    const program = new Command();
    registerWorkspacePlan(program);

    await program.parseAsync(["node", "nimbase", "plan", "pro", "--no-open"]);

    expect(mocks.openBrowser).not.toHaveBeenCalled();
    expect(mocks.printLine).toHaveBeenCalledWith(
      "https://checkout.stripe.test/session",
    );
  });

  it("reports a direct staff override without opening Stripe", async () => {
    mocks.request.mockResolvedValue({
      action: "override",
      plan: "enterprise",
      status: null,
      warning: null,
    });
    const program = new Command();
    registerWorkspacePlan(program);

    await program.parseAsync(["node", "nimbase", "plan", "enterprise"]);

    expect(mocks.openBrowser).not.toHaveBeenCalled();
    expect(mocks.printLine).toHaveBeenCalledWith(
      "Workspace plan set to enterprise.",
    );
    expect(mocks.printLine).toHaveBeenCalledWith(
      "Recorded in the operator audit log.",
    );
  });

  it("makes repeated requests for the effective plan a no-op", async () => {
    mocks.request.mockResolvedValue({ action: "unchanged", plan: "pro" });
    const program = new Command();
    registerWorkspacePlan(program);

    await program.parseAsync(["node", "nimbase", "plan", "pro"]);

    expect(mocks.printLine).toHaveBeenCalledWith(
      "Workspace is already on pro. No changes made.",
    );
    expect(mocks.openBrowser).not.toHaveBeenCalled();
  });

  it("opens Stripe Portal for subscription-managed changes", async () => {
    mocks.request.mockResolvedValue({
      action: "portal",
      plan: "free",
      url: "https://billing.stripe.test/session",
    });
    const program = new Command();
    registerWorkspacePlan(program);

    await program.parseAsync(["node", "nimbase", "plan", "free"]);

    expect(mocks.printLine).toHaveBeenCalledWith(
      "Complete the plan change in Stripe Billing Portal:",
    );
    expect(mocks.openBrowser).toHaveBeenCalledWith(
      "https://billing.stripe.test/session",
    );
  });

  it("opens the Enterprise contact path without touching Stripe", async () => {
    mocks.request.mockResolvedValue({
      action: "contact",
      plan: "enterprise",
      reason: "enterprise_sales",
      url: "mailto:nimbase.ai@gmail.com",
    });
    const program = new Command();
    registerWorkspacePlan(program);

    await program.parseAsync(["node", "nimbase", "plan", "enterprise"]);

    expect(mocks.printLine).toHaveBeenCalledWith(
      "Contact Nimbase about an Enterprise plan:",
    );
    expect(mocks.openBrowser).toHaveBeenCalledWith(
      "mailto:nimbase.ai@gmail.com",
    );
  });

  it("rejects unknown plans before making a request", async () => {
    const program = new Command();
    registerWorkspacePlan(program);

    await expect(
      program.parseAsync(["node", "nimbase", "plan", "unlimited"]),
    ).rejects.toThrow("plan must be one of: free, pro, enterprise");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
