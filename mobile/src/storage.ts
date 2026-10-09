// Everything the app keeps lives on the phone: a small SQLite database for the
// library and the list of prepared sentences, plus files for each book's text
// and audio under the app's documents folder.
import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import type { BookText, Chapter, Segment } from "../../shared/text";

export interface BookMeta {
  id: string;
  title: string;
  fileName: string;
  segmentCount: number;
  words: number;
  addedAt: number;
  openedAt: number;
  /** Index of the sentence to resume from. */
  position: number;
  voiceId: string | null;
  rate: number;
}

export interface BookContent {
  segments: Segment[];
  chapters: Chapter[];
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync("flybook.db").then(async (d) => {
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        fileName TEXT NOT NULL,
        segmentCount INTEGER NOT NULL,
        words INTEGER NOT NULL,
        addedAt INTEGER NOT NULL,
        openedAt INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        voiceId TEXT,
        rate REAL NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS clips (
        bookId TEXT NOT NULL,
        idx INTEGER NOT NULL,
        voiceId TEXT NOT NULL,
        file TEXT NOT NULL,
        durationMs REAL NOT NULL,
        PRIMARY KEY (bookId, idx)
      );
    `);
    return d;
  });
  return dbPromise;
}

const booksDir = () => new Directory(Paths.document, "books");
export const bookDir = (id: string) => new Directory(Paths.document, "books", id);
export const audioDir = (id: string) => new Directory(Paths.document, "books", id, "audio");

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listBooks(): Promise<BookMeta[]> {
  return (await db()).getAllAsync<BookMeta>("SELECT * FROM books ORDER BY openedAt DESC");
}

export async function getBook(id: string): Promise<BookMeta | null> {
  return (await db()).getFirstAsync<BookMeta>("SELECT * FROM books WHERE id = ?", id);
}

export async function addBook(title: string, fileName: string, text: BookText): Promise<string> {
  const id = newId();
  const dir = bookDir(id);
  dir.create({ intermediates: true, idempotent: true });
  new File(dir, "text.json").write(JSON.stringify({ segments: text.segments, chapters: text.chapters }));
  const now = Date.now();
  await (await db()).runAsync(
    "INSERT INTO books (id, title, fileName, segmentCount, words, addedAt, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    title,
    fileName,
    text.segments.length,
    text.words,
    now,
    now
  );
  return id;
}

export async function loadContent(id: string): Promise<BookContent> {
  return JSON.parse(await new File(bookDir(id), "text.json").text()) as BookContent;
}

export async function updateBook(id: string, patch: Partial<Pick<BookMeta, "position" | "openedAt" | "voiceId" | "rate" | "title">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  await (await db()).runAsync(
    `UPDATE books SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    ...keys.map((k) => patch[k] as string | number | null),
    id
  );
}

export async function deleteBook(id: string) {
  const d = await db();
  await d.runAsync("DELETE FROM clips WHERE bookId = ?", id);
  await d.runAsync("DELETE FROM books WHERE id = ?", id);
  const dir = bookDir(id);
  if (dir.exists) dir.delete();
}

// ---------- Prepared audio ----------

export interface Clip {
  idx: number;
  voiceId: string;
  file: string;
  durationMs: number;
}

export async function listClips(bookId: string): Promise<Clip[]> {
  return (await db()).getAllAsync<Clip>("SELECT idx, voiceId, file, durationMs FROM clips WHERE bookId = ?", bookId);
}

export async function saveClip(bookId: string, clip: Clip) {
  await (await db()).runAsync(
    "INSERT OR REPLACE INTO clips (bookId, idx, voiceId, file, durationMs) VALUES (?, ?, ?, ?, ?)",
    bookId,
    clip.idx,
    clip.voiceId,
    clip.file,
    clip.durationMs
  );
}

/** Removes a book's audio but keeps the book. */
export async function clearAudio(bookId: string) {
  await (await db()).runAsync("DELETE FROM clips WHERE bookId = ?", bookId);
  const dir = audioDir(bookId);
  if (dir.exists) dir.delete();
}

/** Bytes used by one book's audio. */
export function audioBytes(bookId: string): number {
  const dir = audioDir(bookId);
  return dir.exists ? (dir.size ?? 0) : 0;
}

export function freeBytes(): number {
  return Paths.availableDiskSpace;
}

export function ensureBooksDir() {
  booksDir().create({ intermediates: true, idempotent: true });
}
