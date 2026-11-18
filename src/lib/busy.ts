// Knows when the app is doing something a page reload would interrupt:
// an IndexedDB write, a PDF import, audio playing, or the listener typing.
// Used to delay the one-time first-visit reload until nothing would be lost.
const reasons = new Set<string>();
let openTransactions = 0;
let lastActivity = Date.now();

function changed() {
  lastActivity = Date.now();
}

/** Marks a long-running activity (import, playback) as started or finished. */
export function setBusy(reason: string, busy: boolean) {
  if (busy) reasons.add(reason);
  else reasons.delete(reason);
  changed();
}

function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "file" && (el as HTMLInputElement).type !== "range") || el.isContentEditable);
}

export function isBusy(): boolean {
  return openTransactions > 0 || reasons.size > 0 || typing();
}

/** Counts IndexedDB transactions, so a reload never cuts a save in half. */
export function trackStorageWrites() {
  if (typeof IDBDatabase === "undefined") return;
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
    const tx = original.apply(this, args);
    if (tx.mode !== "readonly") {
      openTransactions++;
      changed();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        openTransactions--;
        changed();
      };
      tx.addEventListener("complete", finish);
      tx.addEventListener("abort", finish);
      tx.addEventListener("error", finish);
    }
    return tx;
  } as IDBDatabase["transaction"];
}

/** Resolves once nothing has been busy for `quietMs`. */
export function whenIdle(quietMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    // Polled, because focus (typing) and playback can change without an event here.
    const timer = setInterval(() => {
      if (isBusy()) lastActivity = Date.now();
      else if (Date.now() - lastActivity >= quietMs) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });
}

// Typing counts as activity too.
if (typeof document !== "undefined") {
  document.addEventListener("input", () => (lastActivity = Date.now()), true);
  document.addEventListener("focusin", () => (lastActivity = Date.now()), true);
}
