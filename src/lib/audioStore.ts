// Generated narration is saved on the device, so a sentence is only ever
// generated once: replaying, rewinding, re-opening a book or listening to a
// chapter that was prepared earlier is instant and never buffers.
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

type ClipKey = [book: string, voice: string, index: number];

interface AudioDB extends DBSchema {
  /** The audio itself. */
  clips: { key: ClipKey; value: { book: string; voice: string; index: number; wav: Blob } };
  /** Small records (no audio) so we can know what's prepared without loading audio. */
  lengths: {
    key: ClipKey;
    value: { book: string; voice: string; index: number; seconds: number; bytes: number; at: number };
    indexes: { at: number };
  };
}

/** Above this, the oldest saved audio is removed to make room. */
const MAX_BYTES = 600 * 1024 * 1024;

// Version 1 may hold distorted audio from a broken GPU mode: discard it.
const DB_NAME = "flybook-audio-2";
const OLD_DB_NAMES = ["flybook-audio"];

let dbPromise: Promise<IDBPDatabase<AudioDB>> | null = null;
function db() {
  if (!dbPromise) for (const name of OLD_DB_NAMES) void deleteDB(name).catch(() => undefined);
  dbPromise ??= openDB<AudioDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore("clips", { keyPath: ["book", "voice", "index"] });
      d.createObjectStore("lengths", { keyPath: ["book", "voice", "index"] }).createIndex("at", "at");
    },
  });
  return dbPromise;
}

function bookRange(book: string, voice: string) {
  return IDBKeyRange.bound([book, voice, 0], [book, voice, Number.MAX_SAFE_INTEGER]);
}

/** Seconds of every saved sentence for this book and voice, by sentence index. */
export async function savedLengths(book: string, voice: string): Promise<Map<number, number>> {
  try {
    const rows = await (await db()).getAll("lengths", bookRange(book, voice));
    return new Map(rows.map((r) => [r.index, r.seconds]));
  } catch {
    return new Map();
  }
}

export async function loadClip(book: string, voice: string, index: number): Promise<Blob | null> {
  try {
    const row = await (await db()).get("clips", [book, voice, index]);
    return row?.wav ?? null;
  } catch {
    return null;
  }
}

let writesSincePrune = 0;

export async function saveClip(book: string, voice: string, index: number, wav: Blob, seconds: number) {
  try {
    const tx = (await db()).transaction(["clips", "lengths"], "readwrite");
    await Promise.all([
      tx.objectStore("clips").put({ book, voice, index, wav }),
      tx.objectStore("lengths").put({ book, voice, index, seconds, bytes: wav.size, at: Date.now() }),
      tx.done,
    ]);
    if (++writesSincePrune >= 40) {
      writesSincePrune = 0;
      void prune();
    }
  } catch {
    /* storage full or unavailable: playback still works from memory */
  }
}

/** Removes the oldest saved audio once the total passes MAX_BYTES. */
async function prune() {
  const d = await db();
  const rows = await d.getAllFromIndex("lengths", "at");
  let total = rows.reduce((n, r) => n + r.bytes, 0);
  if (total <= MAX_BYTES) return;
  const tx = d.transaction(["clips", "lengths"], "readwrite");
  for (const r of rows) {
    if (total <= MAX_BYTES * 0.8) break;
    const key: ClipKey = [r.book, r.voice, r.index];
    void tx.objectStore("clips").delete(key);
    void tx.objectStore("lengths").delete(key);
    total -= r.bytes;
  }
  await tx.done;
}

export async function deleteBookAudio(book: string) {
  try {
    const range = IDBKeyRange.bound([book, "", 0], [book, "￿", Number.MAX_SAFE_INTEGER]);
    const tx = (await db()).transaction(["clips", "lengths"], "readwrite");
    await Promise.all([tx.objectStore("clips").delete(range), tx.objectStore("lengths").delete(range), tx.done]);
  } catch {
    /* ignore */
  }
}
