import { expect, test } from "@playwright/test";

// The first visit reloads once to turn on multi-core voices. That reload must
// wait until nothing would be lost.
const isolated = (page: import("@playwright/test").Page) => page.evaluate(() => window.crossOriginIsolated);

test("an action taken right away on the first visit survives the one-time reload", async ({ page }) => {
  await page.goto("./");
  // Act immediately, without waiting for the service worker.
  await page.getByRole("button", { name: /sample story/i }).click();
  await page.getByRole("tab", { name: "Read" }).click();
  await page.locator('.seg[data-i="2"]').click();
  await page.getByRole("button", { name: "Highlight Green" }).click();
  await expect(page.locator('.seg[data-i="2"]')).toHaveClass(/hl-green/);
  // The reload still happens once things are quiet...
  await expect.poll(() => isolated(page).catch(() => false), { timeout: 20_000 }).toBe(true);
  // ...and the highlight is still there afterwards.
  await page.getByRole("tab", { name: "Read" }).click();
  await expect(page.locator('.seg[data-i="2"]')).toHaveClass(/hl-green/);
});

test("the one-time reload waits while a note is being written", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /sample story/i }).click();
  await page.getByRole("tab", { name: "Read" }).click();
  await page.locator('.seg[data-i="3"]').click();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  const box = page.getByRole("textbox", { name: "Note" });
  await box.fill("A half-written thought");
  // Long enough for the service worker to be ready and the reload to be due.
  await page.waitForTimeout(4000);
  await expect(box).toHaveValue("A half-written thought");
  expect(await isolated(page)).toBe(false);
  // Save the note: once idle, the reload happens and the note is kept.
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => isolated(page).catch(() => false), { timeout: 20_000 }).toBe(true);
  await page.getByRole("tab", { name: "Read" }).click();
  await expect(page.locator('.seg[data-i="3"]')).toHaveClass(/has-note/);
});
