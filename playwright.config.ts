import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the production build served under /flybook/
// (the GitHub Pages path). Run `npm run build` first.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173/flybook/",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: "node e2e/serve.mjs", url: "http://localhost:4173/flybook/", reuseExistingServer: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
