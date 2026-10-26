// How much this site may store, whether the browser has agreed to keep it,
// and what is using it. Browsers only give estimates, and even "persistent"
// storage is removed when the user clears site data.
type Listener = () => void;

export interface StorageInfo {
  /** Bytes used by this site, as estimated by the browser. */
  usage: number | null;
  /** Bytes this site may use, as estimated by the browser. */
  quota: number | null;
  /** The browser agreed not to evict this site's data under storage pressure. */
  persisted: boolean | null;
  supported: boolean;
}

class StorageService {
  info: StorageInfo = { usage: null, quota: null, persisted: null, supported: typeof navigator !== "undefined" && !!navigator.storage };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  getInfo = () => this.info;

  async refresh(): Promise<StorageInfo> {
    const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!s) return this.info;
    const [estimate, persisted] = await Promise.all([
      s.estimate?.().catch(() => null) ?? null,
      s.persisted?.().catch(() => null) ?? null,
    ]);
    this.info = {
      supported: true,
      usage: estimate?.usage ?? null,
      quota: estimate?.quota ?? null,
      persisted: persisted ?? null,
    };
    this.listeners.forEach((fn) => fn());
    return this.info;
  }

  /** Asks the browser to keep this site's data. It may say no; that's reported honestly. */
  async requestPersistence(): Promise<boolean> {
    const granted = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
    await this.refresh();
    return granted;
  }
}

export const storage = new StorageService();

/** True when `bytes` more would probably fit (with a margin), per the browser's estimate. */
export function likelyFits(info: StorageInfo, bytes: number): boolean {
  if (info.usage === null || info.quota === null) return true;
  return info.usage + bytes * 1.1 < info.quota;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
