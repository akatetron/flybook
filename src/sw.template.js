// Flybook service worker.
// 1. Offline: caches the app so it opens without a connection.
// 2. Speed: adds cross-origin isolation headers so the on-device voice engine
//    can use several CPU cores (static hosts like GitHub Pages can't set them).
//
// Every build gets its own cache: the build replaces __FLYBOOK_BUILD__ below
// with a hash of the build's files (vite.config.ts writes the result to
// dist/sw.js), and old caches are
// deleted when the new worker activates.
const BUILD = "__FLYBOOK_BUILD__";
const CACHE = `flybook-app-${BUILD}`;

self.addEventListener("install", () => {
  // First install: take over straight away (there is no old version to replace).
  // Updates wait until the page asks, so it can offer "Update available — reload".
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("flybook-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isolate(response) {
  if (!response || response.status === 0 || response.type === "opaque") return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Content-hashed build output: the name changes whenever the content does. */
const isHashedAsset = (url) => /\/assets\/[^/]+-[\w-]{6,}\.[a-z0-9]+$/i.test(url.pathname);

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return isolate(hit);
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => undefined);
  return isolate(res);
}

/** Fresh when online (so un-hashed files like the manifest and icons update), cached when offline. */
async function networkFirst(req, cacheKey = req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(cacheKey, res.clone()).catch(() => undefined);
    return isolate(res);
  } catch (err) {
    const hit = await cache.match(cacheKey);
    if (hit) return isolate(hit);
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return; // always from the network, never cached

  if (req.mode === "navigate") {
    // Every page of this single-page app is the same shell.
    event.respondWith(networkFirst(req, new URL("./", self.registration.scope).href));
    return;
  }
  event.respondWith(isHashedAsset(url) ? cacheFirst(req) : networkFirst(req));
});
