import { afterEach, describe, expect, it, vi } from "vitest";

import { connectDeployment } from "./deployment-oauth";

describe("deployment OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a matching loopback state and returns the deployment slug", async () => {
    let stderr = "";
    let resolveUrl: ((url: string) => void) | undefined;
    const installUrl = new Promise<string>((resolve) => {
      resolveUrl = resolve;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      const match =
        /(https:\/\/app\.example\.com\/api\/agents\/slack\/install[^\s]+)/.exec(
          stderr,
        );
      if (match?.[1]) resolveUrl?.(match[1]);
      return true;
    });

    const pending = connectDeployment({
      baseUrl: "https://app.example.com",
      agentId: "09bd8306-fc65-44ab-99b3-f819810b0ee8",
      slug: "support-assistant",
      platform: "slack",
      open: false,
    });
    const install = new URL(await installUrl);
    const callback = new URL(install.searchParams.get("redirect") ?? "");
    callback.searchParams.set("slug", "support-assistant");
    const response = await fetch(callback);

    expect(response.status).toBe(200);
    await expect(pending).resolves.toBe("support-assistant");
  });

  it("reports OAuth failures without waiting for the timeout", async () => {
    let stderr = "";
    let resolveUrl: ((url: string) => void) | undefined;
    const installUrl = new Promise<string>((resolve) => {
      resolveUrl = resolve;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      const match =
        /(https:\/\/app\.example\.com\/api\/agents\/slack\/install[^\s]+)/.exec(
          stderr,
        );
      if (match?.[1]) resolveUrl?.(match[1]);
      return true;
    });

    const pending = connectDeployment({
      baseUrl: "https://app.example.com",
      agentId: "09bd8306-fc65-44ab-99b3-f819810b0ee8",
      slug: "support-assistant",
      platform: "slack",
      open: false,
    });
    const install = new URL(await installUrl);
    const callback = new URL(install.searchParams.get("redirect") ?? "");
    callback.searchParams.set("error", "access_denied");
    const rejection = expect(pending).rejects.toThrow(
      "Deployment failed: access denied",
    );
    const response = await fetch(callback);

    expect(response.status).toBe(400);
    await rejection;
  });
});
