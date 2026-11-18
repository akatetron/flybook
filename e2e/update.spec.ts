import { expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
// @ts-expect-error plain JS helper
import { startServer } from "./serve.mjs";

// Serves its own copy of the build so it can "deploy" a new version mid-test.
const PORT = 4190;
let dir = "";
let server: Server;

// The service-worker flow doesn't depend on the viewport: run it once.
test.beforeAll(async ({}, info) => {
  test.skip(info.project.name !== "desktop", "runs on the desktop project only");
  dir = await mkdtemp(join(tmpdir(), "flybook-deploy-"));
  await cp(new URL("../dist/", import.meta.url), dir, { recursive: true });
  server = await startServer(dir, PORT);
});
test.afterAll(async () => {
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const manifestName = (page: import("@playwright/test").Page) =>
  page.evaluate(() => fetch("./manifest.webmanifest").then((r) => r.json()).then((m) => m.name as string));
const cacheNames = (page: import("@playwright/test").Page) => page.evaluate(() => caches.keys());

test("a new deploy replaces the cached manifest and offers an update", async ({ page, context }) => {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const url = `http://localhost:${PORT}/`;
  await page.goto(url);
  // First visit installs the worker and reloads once for cross-origin isolation.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await page.waitForLoadState("load");
  const firstName = await manifestName(page);
  const [firstCache] = (await cacheNames(page)).filter((k) => k.startsWith("flybook-app-"));
  expect(firstCache).toMatch(/^flybook-app-[0-9a-f]{12}$/);

  // Deploy: a changed manifest (un-hashed file) and a new build of the worker.
  const manifestPath = join(dir, "manifest.webmanifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, name: "Flybook NEXT" }));
  const swPath = join(dir, "sw.js");
  await writeFile(swPath, (await readFile(swPath, "utf8")).replace(/const BUILD = "[^"]+"/, 'const BUILD = "next00000000"'));

  // The page sees the new manifest at once (network first for un-hashed files)...
  await page.reload();
  expect(firstName).not.toBe("Flybook NEXT");
  expect(await manifestName(page)).toBe("Flybook NEXT");

  // ...and is offered the new version instead of being switched silently.
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  const prompt = page.locator(".update-prompt");
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await Promise.all([page.waitForEvent("load"), prompt.getByRole("button", { name: "Reload" }).click()]);

  // The new worker took over and deleted the old cache.
  await expect.poll(() => cacheNames(page)).toContain("flybook-app-next00000000");
  expect(await cacheNames(page)).not.toContain(firstCache);

  // Offline, the app and the new manifest come from the new cache.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".navbar")).toBeVisible();
  expect(await manifestName(page)).toBe("Flybook NEXT");
  await context.setOffline(false);
});
