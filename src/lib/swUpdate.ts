// Watches for a new version of the app. A new service worker installs in the
// background and waits; the app shows "Update available — reload", and only
// then is the new version switched on (no surprise reloads mid-book).
type Listener = (waiting: boolean) => void;

let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();

function setWaiting(worker: ServiceWorker | null) {
  waiting = worker;
  listeners.forEach((fn) => fn(!!worker));
}

export function onUpdateAvailable(fn: Listener): () => void {
  listeners.add(fn);
  fn(!!waiting);
  return () => void listeners.delete(fn);
}

/** Switches to the waiting version; the page reloads once it has taken over. */
export function applyUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  waiting.postMessage({ type: "SKIP_WAITING" });
}

export function watchForUpdates(reg: ServiceWorkerRegistration) {
  // Only an update counts: the very first install has no controller to replace.
  if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const next = reg.installing;
    next?.addEventListener("statechange", () => {
      if (next.state === "installed" && navigator.serviceWorker.controller) setWaiting(next);
    });
  });
  // Check again when the app comes back to the foreground, and hourly while open.
  const check = () => reg.update().catch(() => undefined);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
  setInterval(check, 60 * 60 * 1000);
}
