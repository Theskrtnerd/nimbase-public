import { defineConfig, devices } from "@playwright/test";

// E2E tests for the Next.js server's browser surfaces. Runs against a real dev
// server booted with the `dev` env injected by Infisical (same as `pnpm dev`).
// Unit tests stay in Vitest (`pnpm test`) — this track is intentionally separate
// and NOT part of `turbo test`, since it needs a running server and browser.
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Fail the build on CI if test.only is committed.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Reuse a dev server you already have running; otherwise boot one. The
    // `dev` script injects env via `infisical run --env dev`, so a fresh
    // machine needs `infisical login` first.
    command: "pnpm dev",
    // The product root intentionally returns 410 while the UI is disabled, so
    // use a stable machine endpoint for Playwright's readiness probe.
    url: `${baseURL}/.well-known/oauth-authorization-server`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
