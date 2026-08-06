import { expect, test } from "@playwright/test";

// Smoke coverage for the disabled product UI. Authentication itself is hosted
// by Clerk and returns to the CLI through the native authorization route.
test.describe("unauthenticated entry", () => {
  test("root returns a plain-text disabled response", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(410);
    await expect(response.text()).resolves.toBe(
      "Nimbase web UI is disabled. Use the nimbase CLI.\n",
    );
  });

  test("dashboard and onboarding return 410", async ({ request }) => {
    const [dashboard, onboarding] = await Promise.all([
      request.get("/dashboard/workspaces/acme"),
      request.get("/onboarding/workspace"),
    ]);
    expect(dashboard.status()).toBe(410);
    expect(onboarding.status()).toBe(410);
  });

  test("native auth delegates sign-in to Clerk", async ({ request }) => {
    const response = await request.get(
      "/desktop/authorize?challenge=challenge&state=state",
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(307);
    const location = response.headers().location;
    expect(location).toMatch(/^https:\/\/accounts\.nimbase\.ai\/sign-in\?/);
    expect(location).toContain("redirect_url=");
  });
});
