import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { audioUsage, deleteBookAudio, deleteVoiceAudio, storageWarning, type AudioUsage } from "../lib/audioStore";
import { deleteBook, listAnnotations, listBooks, type BookMeta } from "../lib/db";
import { formatBytes, storage } from "../lib/storage";
import { formatDuration } from "../lib/format";
import { allModels, models } from "../tts/modelStore";
import { STATUS_LABEL, type ModelInfo } from "../tts/registry";
import { STUDIO_VOICES } from "../tts/voices";

const voiceName = (id: string) => STUDIO_VOICES.find((v) => v.id === id)?.name ?? id;

export function StorageScreen() {
  const info = useSyncExternalStore((fn) => storage.subscribe(fn), storage.getInfo);
  useSyncExternalStore(
    (fn) => models.subscribe(fn),
    () => models.version
  );
  const [audio, setAudio] = useState<AudioUsage[] | null>(null);
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [a, b, notes] = await Promise.all([audioUsage(), listBooks(), listAnnotations().catch(() => [])]);
    setAudio(a);
    setBooks(b);
    const counts = new Map<string, number>();
    for (const n of notes) counts.set(n.bookId, (counts.get(n.bookId) ?? 0) + 1);
    setNoteCounts(counts);
    void storage.refresh();
  }, []);

  useEffect(() => {
    void refresh();
    void models.verifyAll();
  }, [refresh]);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
    } catch (e) {
      setMessage(`That didn't work: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function requestPersist() {
    const granted = await storage.requestPersistence();
    setMessage(
      granted
        ? "The browser agreed to keep Flybook's data when space runs low. Clearing site data still removes it."
        : "The browser didn't grant persistent storage (it decides this itself, often based on how much you use the site). Your data is still saved, but may be removed if the device runs short of space."
    );
  }

  const installed = allModels()
    .map((m) => ({ model: m, check: models.check(m.id) }))
    .filter(({ check }) => check && check.status !== "not-downloaded");
  const titles = new Map(books.map((b) => [b.id, b.title]));
  const docAudio = (audio ?? []).filter((a) => !a.book.startsWith("__preview__"));
  const previewAudio = (audio ?? []).filter((a) => a.book.startsWith("__preview__"));
  const sum = (list: AudioUsage[]) => list.reduce((n, a) => n + a.bytes, 0);
  const modelBytes = installed.reduce((n, { check }) => n + (check?.bytes ?? 0), 0);

  return (
    <div className="screen storage">
      <header className="screen-head">
        <h1>Offline storage</h1>
        <p className="muted">
          Everything below is stored in this browser on this device. It normally survives refreshing and closing the page,
          but it is removed if you clear this site's data, and the browser may remove it if the device runs out of space.
          It isn't shared with other browsers or devices.
        </p>
      </header>

      {message && (
        <p className="alert" role="status">
          {message}
        </p>
      )}
      {storageWarning && <p className="alert">Some prepared audio couldn't be saved — storage may be full.</p>}

      <section className="card storage-summary">
        <h2>This browser</h2>
        {!info.supported ? (
          <p className="muted">This browser doesn't report storage use.</p>
        ) : (
          <>
            <p>
              {info.usage !== null && info.quota !== null ? (
                <>
                  About <strong>{formatBytes(info.usage)}</strong> used of roughly {formatBytes(info.quota)} available
                  <span className="muted small"> (the browser's estimate)</span>
                </>
              ) : (
                "Usage estimate unavailable."
              )}
            </p>
            {info.usage !== null && info.quota ? (
              <div className="bar" aria-hidden>
                <div className="bar-fill" style={{ width: `${Math.min(100, (info.usage / info.quota) * 100)}%` }} />
              </div>
            ) : null}
            <ul className="breakdown">
              <li>
                Voice models <span>{formatBytes(modelBytes)}</span>
              </li>
              <li>
                Prepared audio <span>{formatBytes(sum(docAudio))}</span>
              </li>
              <li>
                Voice previews <span>{formatBytes(sum(previewAudio))}</span>
              </li>
            </ul>
            <p className="small">
              Persistent storage:{" "}
              {info.persisted === true ? (
                <strong>granted</strong>
              ) : info.persisted === false ? (
                <>
                  not granted{" "}
                  <button className="link" onClick={requestPersist}>
                    Ask the browser
                  </button>
                </>
              ) : (
                "unknown"
              )}
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Voice models</h2>
        {installed.length === 0 ? (
          <p className="muted">No voice models are stored yet. They download the first time you use or preview a voice.</p>
        ) : (
          <ul className="storage-list">
            {installed.map(({ model, check }) => (
              <ModelRow
                key={model.id}
                model={model}
                status={check!.status}
                bytes={check!.bytes}
                checkedAt={check!.checkedAt}
                busy={busy === model.id}
                onRepair={() => act(model.id, () => models.repair(model), "Damaged files were removed. They download again the next time the voice is used; intact files are kept.")}
                onRemove={() =>
                  confirm(`Remove ${model.name}? Prepared audio, documents and notes are kept. The voice downloads again if you use it.`) &&
                  act(model.id, () => models.remove(model), `${model.name} removed.`)
                }
              />
            ))}
          </ul>
        )}
        <button className="btn small" onClick={() => act("verify", () => models.verifyAll(), "Checked every stored voice file.")} disabled={busy === "verify"}>
          Check files again
        </button>
      </section>

      <section className="card">
        <h2>Prepared audio</h2>
        <p className="muted small">Deleting prepared audio keeps the document, its notes and your place; it can be prepared again.</p>
        {audio === null ? (
          <p className="muted">Loading…</p>
        ) : docAudio.length === 0 ? (
          <p className="muted">No prepared audio.</p>
        ) : (
          <ul className="storage-list">
            {docAudio.map((a) => (
              <li key={a.book + a.voice}>
                <span className="storage-name">
                  {titles.get(a.book) ?? "Removed document"}
                  <span className="muted small">
                    {" "}
                    · {voiceName(a.voice)} · {a.clips} sentences · {formatDuration(a.seconds / 60)}
                  </span>
                </span>
                <span className="storage-size">{formatBytes(a.bytes)}</span>
                <button className="btn small" disabled={busy === a.book + a.voice} onClick={() => act(a.book + a.voice, () => deleteVoiceAudio(a.book, a.voice), "Prepared audio deleted.")}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        {previewAudio.length > 0 && (
          <button className="btn small" onClick={() => act("previews", async () => {
            for (const p of previewAudio) await deleteBookAudio(p.book);
          }, "Voice previews deleted.")}>
            Delete voice previews ({formatBytes(sum(previewAudio))})
          </button>
        )}
      </section>

      <section className="card">
        <h2>Documents</h2>
        {books.length === 0 ? (
          <p className="muted">No documents.</p>
        ) : (
          <ul className="storage-list">
            {books.map((b) => {
              const bytes = sum(docAudio.filter((a) => a.book === b.id));
              const notes = noteCounts.get(b.id) ?? 0;
              return (
                <li key={b.id}>
                  <span className="storage-name">
                    {b.title}
                    <span className="muted small">
                      {" "}
                      · {b.pageCount} {b.pageCount === 1 ? "page" : "pages"}
                      {notes ? ` · ${notes} notes/highlights` : ""}
                      {bytes ? ` · ${formatBytes(bytes)} audio` : ""}
                    </span>
                  </span>
                  <button
                    className="btn small danger"
                    disabled={busy === b.id}
                    onClick={() =>
                      confirm(
                        `Remove “${b.title}”? This deletes its text${b.hasFile ? ", the original file" : ""}, your place in it, ${notes} highlights/notes/bookmarks and ${formatBytes(bytes)} of prepared audio from this device. This can't be undone.`
                      ) && act(b.id, () => Promise.all([deleteBook(b.id), deleteBookAudio(b.id)]), "Document removed.")
                    }
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ModelRow(props: {
  model: ModelInfo;
  status: keyof typeof STATUS_LABEL;
  bytes: number;
  checkedAt: number;
  busy: boolean;
  onRepair: () => void;
  onRemove: () => void;
}) {
  const bad = props.status === "corrupt" || props.status === "missing-files";
  return (
    <li>
      <span className="storage-name">
        {props.model.name}
        <span className={`small ${bad ? "danger-text" : "muted"}`}> · {STATUS_LABEL[props.status]}</span>
        <span className="muted tiny">
          {" "}
          · v{props.model.version} · {props.model.license} · checked {new Date(props.checkedAt).toLocaleTimeString()}
        </span>
      </span>
      <span className="storage-size">{formatBytes(props.bytes)}</span>
      {bad && (
        <button className="btn small" disabled={props.busy} onClick={props.onRepair}>
          Repair
        </button>
      )}
      <button className="btn small" disabled={props.busy} onClick={props.onRemove}>
        Remove
      </button>
    </li>
  );
}
