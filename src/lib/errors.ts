// Turns failures the listener should know about (mostly storage) into one
// clear on-screen message, instead of failing silently.
type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function onError(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The browser refused to store more (quota exceeded / disk full). */
export function isStorageFull(err: unknown): boolean {
  const e = err as { name?: string; message?: string; code?: number } | null;
  if (!e) return false;
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    /quota|no space|disk (is )?full|storage full/i.test(e.message ?? "")
  );
}

/** An IndexedDB / Cache Storage failure other than quota (private mode, blocked or broken storage). */
export function isStorageError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  return isStorageFull(err) || ["UnknownError", "InvalidStateError", "DataError", "VersionError", "SecurityError", "NotFoundError"].includes(name);
}

/** A message a listener can act on. */
export function describeError(err: unknown, action = "save that"): string {
  if (isStorageFull(err)) return `Couldn't ${action}: this browser's storage for Flybook is full. Free space in Storage (prepared audio or voices you don't use) and try again.`;
  if (isStorageError(err)) return `Couldn't ${action}: this browser's storage isn't available (private browsing or blocked site data can cause this).`;
  const message = (err as Error | null)?.message;
  return `Couldn't ${action}${message ? `: ${message}` : "."}`;
}

let last = { message: "", at: 0 };

/** Shows an error to the listener (the same message at most once every 10 s). */
export function reportError(err: unknown, action?: string) {
  const message = describeError(err, action);
  const now = Date.now();
  if (message === last.message && now - last.at < 10_000) return;
  last = { message, at: now };
  console.warn(message, err);
  listeners.forEach((fn) => fn(message));
}

/** Runs a background save; a failure is shown instead of being lost. */
export function safely<T>(promise: Promise<T>, action?: string): Promise<T | undefined> {
  return promise.catch((err) => {
    reportError(err, action);
    return undefined;
  });
}

/** Catches storage failures nothing else handled. */
export function installGlobalHandlers() {
  window.addEventListener("unhandledrejection", (event) => {
    if (isStorageError(event.reason)) {
      event.preventDefault();
      reportError(event.reason);
    }
  });
}
