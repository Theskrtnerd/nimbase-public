import { expect, test } from "@playwright/test";

// Smoke coverage for the archived web UI and the browser-assisted CLI login.
// No Clerk credentials are needed because the shell copy is server-rendered.
test.describe("unauthenticated entry", () => {
  test("root presents the CLI-first handoff", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Company memory, from your terminal.",
      }),
    ).toBeVisible();
    await expect(page.getByText("nimbase auth login")).toBeVisible();
  });

  test("archived dashboard URLs redirect to the handoff", async ({ page }) => {
    await page.goto("/dashboard/workspaces/acme");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("CLI-first · Web UI archived")).toBeVisible();
  });

  test("login page renders the sign-in shell", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Sign in from the Nimbase CLI.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Privacy Policy" }),
    ).toBeVisible();
  });
});
