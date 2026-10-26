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
  /** Voice chosen for this document; falls back to the default voice. */
  voice?: string;
  /** Collection (e.g. a matter or course) the document belongs to. */
  collection?: string | null;
  /** The original file is kept on the device (for page view). */
  hasFile?: boolean;
  /** How the PDF's text was judged at import. */
  textQuality?: "text" | "sparse";
  /** When the listener last moved (for "resume" prompts). */
  positionAt?: number;
}

export interface BookContent {
  id: string;
  segments: Segment[];
  chapters: Chapter[];
}

export type AnnotationKind = "highlight" | "note" | "bookmark";
export type HighlightColor = "amber" | "green" | "blue" | "rose";

export interface Annotation {
  id: string;
  bookId: string;
  kind: AnnotationKind;
  /** First and last sentence (segment) of the passage, inclusive. */
  start: number;
  end: number;
  /** PDF page of the first sentence, when known. */
  page: number | null;
  /** The passage as it was when saved, so the anchor can be re-found if text changes. */
  quote: string;
  color: HighlightColor | null;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

export interface StoredFile {
  id: string;
  blob: Blob;
  name: string;
  type: string;
}

interface FlybookDB extends DBSchema {
  books: { key: string; value: BookMeta };
  contents: { key: string; value: BookContent };
  annotations: { key: string; value: Annotation; indexes: { bookId: string } };
  collections: { key: string; value: Collection };
  files: { key: string; value: StoredFile };
}

export const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<FlybookDB>> | null = null;

function db() {
  dbPromise ??= openDB<FlybookDB>("flybook", DB_VERSION, {
    // Versioned: each step only adds stores, so existing books are kept.
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("books", { keyPath: "id" });
        d.createObjectStore("contents", { keyPath: "id" });
      }
      if (oldVersion < 2) {
        d.createObjectStore("annotations", { keyPath: "id" }).createIndex("bookId", "bookId");
        d.createObjectStore("collections", { keyPath: "id" });
        d.createObjectStore("files", { keyPath: "id" });
      }
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

/** Deletes a document with its text, original file and annotations. */
export async function deleteBook(id: string) {
  const d = await db();
  const notes = await d.getAllKeysFromIndex("annotations", "bookId", id);
  const tx = d.transaction(["books", "contents", "files", "annotations"], "readwrite");
  await Promise.all([
    tx.objectStore("books").delete(id),
    tx.objectStore("contents").delete(id),
    tx.objectStore("files").delete(id),
    ...notes.map((k) => tx.objectStore("annotations").delete(k)),
    tx.done,
  ]);
}

export async function saveContent(content: BookContent) {
  await (await db()).put("contents", content);
}

// ---------- original files ----------

export async function saveFile(file: StoredFile) {
  await (await db()).put("files", file);
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  return (await db()).get("files", id);
}

// ---------- annotations ----------

export async function listAnnotations(bookId?: string): Promise<Annotation[]> {
  const d = await db();
  const rows = bookId ? await d.getAllFromIndex("annotations", "bookId", bookId) : await d.getAll("annotations");
  return rows.sort((a, b) => a.bookId.localeCompare(b.bookId) || a.start - b.start || a.createdAt - b.createdAt);
}

export async function saveAnnotation(a: Annotation) {
  await (await db()).put("annotations", a);
}

export async function deleteAnnotation(id: string) {
  await (await db()).delete("annotations", id);
}

// ---------- collections ----------

export async function listCollections(): Promise<Collection[]> {
  return (await (await db()).getAll("collections")).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveCollection(c: Collection) {
  await (await db()).put("collections", c);
}

export async function deleteCollection(id: string) {
  const d = await db();
  const books = (await d.getAll("books")).filter((b) => b.collection === id);
  const tx = d.transaction(["collections", "books"], "readwrite");
  await Promise.all([
    tx.objectStore("collections").delete(id),
    ...books.map((b) => tx.objectStore("books").put({ ...b, collection: null })),
    tx.done,
  ]);
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
