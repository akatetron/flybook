import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** Requests to anything other than this site and Google Fonts. */
function watchThirdParty(page: Page) {
  const seen: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.hostname !== "localhost" && !url.hostname.endsWith("fonts.googleapis.com") && !url.hostname.endsWith("fonts.gstatic.com")) seen.push(r.url());
  });
  return seen;
}

async function openSample(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: /sample story/i }).click();
  await expect(page.getByRole("heading", { name: "The Lighthouse Library" })).toBeVisible();
}

async function readView(page: Page) {
  await page.getByRole("tab", { name: "Read" }).click();
  await expect(page.locator(".seg").first()).toBeVisible();
}

test("fresh visit under /flybook/ shows the library and opens the sample story without downloading a voice", async ({ page }) => {
  const thirdParty = watchThirdParty(page);
  await page.goto("./");
  await expect(page.getByText(/Turn any PDF into an/)).toBeVisible();
  await openSample(page);
  await expect(page.locator(".np-now")).not.toBeEmpty();
  // Opening a book must never start a model download on its own.
  await page.waitForTimeout(1500);
  expect(thirdParty.filter((u) => u.includes("huggingface"))).toEqual([]);
});

test("a highlight, note and bookmark survive a reload and appear in Study", async ({ page }) => {
  await openSample(page);
  await readView(page);
  const second = page.locator('.seg[data-i="2"]');
  await second.click();
  await page.getByRole("button", { name: "Highlight Green" }).click();
  await expect(second).toHaveClass(/hl-green/);

  await page.locator('.seg[data-i="3"]').click();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByRole("textbox", { name: "Note" }).fill("Who keeps the lamp lit?");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('.seg[data-i="3"]')).toHaveClass(/has-note/);

  await page.locator('.seg[data-i="4"]').click();
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect(page.locator('.seg[data-i="4"]')).toHaveClass(/has-bookmark/);

  await page.reload();
  await readView(page);
  await expect(page.locator('.seg[data-i="2"]')).toHaveClass(/hl-green/);
  await expect(page.locator('.seg[data-i="3"]')).toHaveClass(/has-note/);
  await expect(page.locator('.seg[data-i="4"]')).toHaveClass(/has-bookmark/);

  await page.goto("./#/study");
  await expect(page.locator(".annotation")).toHaveCount(3);
  await page.getByRole("searchbox", { name: /search/i }).fill("lamp lit");
  await expect(page.locator(".annotation")).toHaveCount(1);
  await expect(page.locator(".annotation-note")).toHaveText("Who keeps the lamp lit?");
});

test("notes export to Markdown with the document title and page", async ({ page }) => {
  await openSample(page);
  await readView(page);
  await page.locator('.seg[data-i="2"]').click();
  await page.getByRole("button", { name: "Highlight Amber" }).click();
  await page.goto("./#/study");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Markdown" }).click()]);
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("## The Lighthouse Library");
  expect(text).toMatch(/### Highlight \(amber\) · p\. \d+/);
});

test("jumping from a saved note opens the document at that passage", async ({ page }) => {
  await openSample(page);
  await readView(page);
  const target = page.locator('.seg[data-i="6"]');
  const quote = (await target.textContent())!.trim();
  await target.click();
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await page.goto("./#/study");
  await page.getByRole("button", { name: "Go to passage" }).click();
  await expect(page).toHaveURL(/#\/book\/[\w-]+\?at=6$/);
  await expect(page.locator(".np-now")).toHaveText(quote);
});

test("the reading position is restored after reopening", async ({ page }) => {
  await openSample(page);
  await readView(page);
  await page.locator('.seg[data-i="5"]').click();
  // Moves the position there (with no voice downloaded, it then offers the download).
  await page.getByRole("button", { name: /Play from here/ }).click();
  const quote = (await page.locator('.seg[data-i="5"]').textContent())!.trim();
  // Position is saved shortly after moving.
  await page.waitForTimeout(1500);
  const url = page.url();
  await page.goto("./");
  await page.goto(url);
  await expect(page.locator(".toast")).toContainText("Resumed at p.");
  await expect(page.locator(".np-now")).toHaveText(quote);
});

test("Voice Studio, Storage and Settings open; theme choice persists", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Voices" }).click();
  await expect(page.getByRole("heading", { name: "Voice Studio" })).toBeVisible();
  await expect(page.locator(".voice-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("heading", { name: "Offline storage" })).toBeVisible();
  await expect(page.getByText(/No voice models are stored yet/)).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Night" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a file that isn't a valid PDF shows a clear error", async ({ page }) => {
  await page.goto("./");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await expect(page.getByRole("alert")).toContainText(/couldn't be opened|damaged|not really a PDF/i);
});

test("no horizontal scrolling on any main screen", async ({ page }) => {
  for (const hash of ["", "#/study", "#/voices", "#/storage", "#/settings"]) {
    await page.goto(`./${hash}`);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow on ${hash || "library"}`).toBeLessThanOrEqual(1);
  }
  await openSample(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("after one visit the app and a saved book open offline", async ({ page, context }) => {
  await openSample(page);
  // Wait for the service worker to take control (it reloads once on first visit for cross-origin isolation).
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("The Lighthouse Library").first()).toBeVisible();
  await page.getByText("The Lighthouse Library").first().click();
  await expect(page.locator(".np-now")).not.toBeEmpty();
  await context.setOffline(false);
});
