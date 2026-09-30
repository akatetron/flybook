// Everything is stored on the device in IndexedDB — no server, no account.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Chapter, Segment } from "./text";

export interface BookMeta {
  id: string;
  title: string;
  fileName: string;
  pageCount: number;
  segmentCount: number;
  words: number;
  cover: string | null;
  addedAt: number;
  openedAt: number;
  /** Index of the segment the listener is on. */
  position: number;
}

export interface BookContent {
  id: string;
  segments: Segment[];
  chapters: Chapter[];
}

interface FlybookDB extends DBSchema {
  books: { key: string; value: BookMeta };
  contents: { key: string; value: BookContent };
}

let dbPromise: Promise<IDBPDatabase<FlybookDB>> | null = null;

function db() {
  dbPromise ??= openDB<FlybookDB>("flybook", 1, {
    upgrade(d) {
      d.createObjectStore("books", { keyPath: "id" });
      d.createObjectStore("contents", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function listBooks(): Promise<BookMeta[]> {
  const books = await (await db()).getAll("books");
  return books.sort((a, b) => b.openedAt - a.openedAt);
}

export async function getBook(id: string) {
  const d = await db();
  const [meta, content] = await Promise.all([d.get("books", id), d.get("contents", id)]);
  return meta && content ? { meta, content } : null;
}

export async function saveBook(meta: BookMeta, content: BookContent) {
  const tx = (await db()).transaction(["books", "contents"], "readwrite");
  await Promise.all([tx.objectStore("books").put(meta), tx.objectStore("contents").put(content), tx.done]);
  // Ask the browser not to evict the library under storage pressure.
  navigator.storage?.persist?.().catch(() => undefined);
}

export async function updateBook(id: string, patch: Partial<BookMeta>) {
  const d = await db();
  const meta = await d.get("books", id);
  if (meta) await d.put("books", { ...meta, ...patch });
}

export async function deleteBook(id: string) {
  const tx = (await db()).transaction(["books", "contents"], "readwrite");
  await Promise.all([tx.objectStore("books").delete(id), tx.objectStore("contents").delete(id), tx.done]);
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
