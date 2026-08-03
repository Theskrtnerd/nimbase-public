import { expect, test } from "@playwright/test";

// Smoke coverage for the unauthenticated entrypoint. No Clerk credentials
// needed: the root redirects to /login, and the login shell's heading + legal
// links are server-rendered (independent of the Clerk widget loading). This is
// the seed for the E2E track — authenticated flows come later via Clerk test
// tokens.
test.describe("unauthenticated entry", () => {
  test("root redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page renders the sign-in shell", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Sign in to your workspaces.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Privacy Policy" }),
    ).toBeVisible();
  });
});
