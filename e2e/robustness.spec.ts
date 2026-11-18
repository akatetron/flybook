import { expect, test } from "@playwright/test";

test("works when the browser refuses persistent storage", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, "persist", { value: () => Promise.resolve(false) });
    Object.defineProperty(StorageManager.prototype, "persisted", { value: () => Promise.resolve(false) });
  });
  await page.goto("./");
  // The first visit reloads once to turn on cross-origin isolation; wait for that.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: /sample story/i }).click();
  await page.getByRole("tab", { name: "Read" }).click();
  await page.locator('.seg[data-i="2"]').click();
  await page.getByRole("button", { name: "Highlight Blue" }).click();
  await expect(page.locator('.seg[data-i="2"]')).toHaveClass(/hl-blue/);
  await page.reload();
  await page.getByRole("tab", { name: "Read" }).click();
  await expect(page.locator('.seg[data-i="2"]')).toHaveClass(/hl-blue/);
  await page.goto("./#/storage");
  await expect(page.getByText(/Persistent storage:\s*not granted/)).toBeVisible();
  await page.getByRole("button", { name: "Ask the browser" }).click();
  await expect(page.getByRole("status")).toContainText("didn't grant persistent storage");
});

test("a full disk shows a clear message instead of failing silently", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /sample story/i }).click();
  await page.getByRole("tab", { name: "Read" }).click();
  // From now on every IndexedDB write fails as if the disk were full.
  await page.evaluate(() => {
    const fail = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    IDBObjectStore.prototype.put = fail;
    IDBObjectStore.prototype.add = fail;
  });
  await page.locator('.seg[data-i="3"]').click();
  await page.getByRole("button", { name: "Highlight Amber" }).click();
  await expect(page.locator(".toast")).toContainText(/storage .* is full/i);
  await expect(page.locator('.seg[data-i="3"]')).not.toHaveClass(/hl-amber/);
});

test("an interrupted voice download is detected and Repair recovers it", async ({ page }) => {
  await page.goto("./");
  // The first visit reloads once to turn on cross-origin isolation; wait for that.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await page.waitForLoadState("load");
  // A Piper voice download that was interrupted: the small config file arrived
  // damaged and the large model file never finished (so it was never stored).
  await page.evaluate(async () => {
    const base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/en_US-kristin-medium";
    const cache = await caches.open("flybook-piper-v1");
    await cache.put(`${base}.onnx.json`, new Response("{", { headers: { "content-length": "4000" } }));
  });
  await page.goto("./#/storage");
  await page.getByRole("button", { name: "Check files again" }).click();
  const row = page.locator(".storage-list li", { hasText: "kristin" });
  await expect(row).toContainText("Damaged files");
  await row.getByRole("button", { name: "Repair" }).click();
  await expect(page.getByRole("status")).toContainText("Damaged files were removed (1)");
  // Nothing half-downloaded is left behind, so the next use downloads the voice cleanly.
  const left = await page.evaluate(async () => (await (await caches.open("flybook-piper-v1")).keys()).length);
  expect(left).toBe(0);
  await expect(row).toHaveCount(0);
});

test("a voice whose model file never arrived is not reported as ready", async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    const base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/medium/en_GB-cori-medium";
    await (await caches.open("flybook-piper-v1")).put(`${base}.onnx.json`, new Response("{}", { headers: { "content-length": "2" } }));
  });
  await page.goto("./#/storage");
  await page.getByRole("button", { name: "Check files again" }).click();
  const row = page.locator(".storage-list li", { hasText: "cori" });
  await expect(row).toContainText("Some files missing");
  await row.getByRole("button", { name: "Repair" }).click();
  await expect(page.getByRole("status")).toContainText("No damaged files. The missing files download");
});

test("a listener whose voice was removed for licence reasons is moved to a licensed one and told once", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("flybook:settings", JSON.stringify({ engine: "studio", studioVoice: "piper:en_US-amy-medium" }));
    }
  });
  await page.goto("./");
  await expect(page.locator(".voice-notice")).toContainText("Amy → Kristin");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("flybook:settings")!).studioVoice)).toBe("piper:en_US-kristin-medium");
  await page.locator(".voice-notice").getByRole("button", { name: "OK" }).click();
  await page.reload();
  await expect(page.locator(".voice-notice")).toHaveCount(0);
});
