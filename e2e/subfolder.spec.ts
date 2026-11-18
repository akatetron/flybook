import { expect, test } from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
// @ts-expect-error plain JS helper
import { startServer } from "./serve.mjs";

// The build must also work from a sub-folder (e.g. user.github.io/flybook/).
const PORT = 4191;
let root = "";
let server: Server;

test.beforeAll(async ({}, info) => {
  test.skip(info.project.name !== "desktop", "runs on the desktop project only");
  root = await mkdtemp(join(tmpdir(), "flybook-sub-"));
  await cp(new URL("../dist/", import.meta.url), join(root, "some", "folder"), { recursive: true });
  server = await startServer(root, PORT);
});
test.afterAll(async () => {
  server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("the build works from a sub-folder", async ({ page, context }) => {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const failed: string[] = [];
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://localhost:${PORT}/some/folder/`);
  await page.getByRole("button", { name: /sample story/i }).click();
  await expect(page.getByRole("heading", { name: "The Lighthouse Library" })).toBeVisible();
  const scope = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.scope));
  expect(scope).toBe(`http://localhost:${PORT}/some/folder/`);
  expect(failed).toEqual([]);
});
