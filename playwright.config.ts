import { chromium, defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The Chromium to run: PW_CHROMIUM if set; otherwise Playwright's own download;
 * otherwise any Chromium already installed in PLAYWRIGHT_BROWSERS_PATH (some
 * machines ship a newer build than this Playwright version expects).
 */
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  if (existsSync(chromium.executablePath())) return undefined;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const sub of ["chrome-linux64", "chrome-linux"]) {
      const exe = join(root, dir, sub, "chrome");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}
const executablePath = chromiumPath();

// Browser tests run against the production build served at the root, as on
// flybookapp.in. Run `npm run build` first.
export default defineConfig({
  testDir: "e2e",
  // zz-*.spec.ts are local one-off scripts (screenshots, manual runs), not part of the suite.
  testIgnore: "**/zz-*.spec.ts",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173/",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: { command: "node e2e/serve.mjs", url: "http://localhost:4173/", reuseExistingServer: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
