// Studio voices: the Kokoro-82M neural voice (Apache-2.0) running on the
// phone. The model and voices are downloaded once from Hugging Face and kept
// in the app's storage; after that everything works offline. Pronunciation
// comes from the misaki dictionaries bundled with the app (shared/g2p.ts).
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import { G2P, Lexicon, type Dictionary } from "../../shared/g2p";
import Native from "../modules/flybook-native";

const REPO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
const MODEL = "onnx/model_quantized.onnx";
/** Approximate, for the download prompt; the real size comes from the server. */
export const MODEL_MB = 92;

export interface StudioVoice {
  id: string;
  name: string;
  accent: string;
  gender: "Female" | "Male";
}

// The best-rated American English voices (ratings from the Kokoro voice list).
export const STUDIO_VOICES: StudioVoice[] = [
  { id: "af_heart", name: "Heart", accent: "American", gender: "Female" },
  { id: "af_bella", name: "Bella", accent: "American", gender: "Female" },
  { id: "af_nicole", name: "Nicole", accent: "American", gender: "Female" },
  { id: "am_michael", name: "Michael", accent: "American", gender: "Male" },
  { id: "am_fenrir", name: "Fenrir", accent: "American", gender: "Male" },
  { id: "am_puck", name: "Puck", accent: "American", gender: "Male" },
];

export const STUDIO_PREFIX = "kokoro:";
export const isStudio = (voiceId: string) => voiceId.startsWith(STUDIO_PREFIX);

const dir = () => new Directory(Paths.document, "kokoro");
const modelFile = () => new File(dir(), "model_quantized.onnx");
const vocabFile = () => new File(dir(), "tokenizer.json");
const voiceFile = (id: string) => new File(dir(), `${id}.bin`);

export function isInstalled(): boolean {
  return modelFile().exists && vocabFile().exists;
}

export function voiceInstalled(id: string): boolean {
  return voiceFile(id).exists;
}

async function download(path: string, dest: File, onProgress?: (fraction: number) => void) {
  dir().create({ intermediates: true, idempotent: true });
  // Download beside the destination, then move, so a cut-off download never looks finished.
  const part = new File(dir(), dest.name + ".part");
  if (part.exists) part.delete();
  await File.downloadFileAsync(`${REPO}/${path}`, part, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => totalBytes > 0 && onProgress?.(bytesWritten / totalBytes),
  });
  if (dest.exists) dest.delete();
  await part.move(dest);
}

/** Downloads the model (about 92 MB) and the character map. */
export async function install(onProgress: (fraction: number) => void) {
  if (!vocabFile().exists) await download("tokenizer.json", vocabFile());
  if (!modelFile().exists) await download(MODEL, modelFile(), onProgress);
  onProgress(1);
}

export async function installVoice(id: string) {
  if (!voiceFile(id).exists) await download(`voices/${id}.bin`, voiceFile(id));
}

/** Deletes the model and voices (the prepared audio stays). */
export function uninstall() {
  const d = dir();
  if (d.exists) d.delete();
  engine = null;
  styles.clear();
}

export function installedBytes(): number {
  const d = dir();
  return d.exists ? (d.size ?? 0) : 0;
}

// ---------- Synthesis ----------

interface Engine {
  g2p: G2P;
  vocab: Map<string, number>;
}

let engine: Promise<Engine> | null = null;
const styles = new Map<string, Float32Array>();

function loadEngine(): Promise<Engine> {
  engine ??= (async () => {
    const [asset] = await Asset.loadAsync(require("../assets/kokoro/us_lexicon.txt"));
    const lexicon = JSON.parse(await new File(asset.localUri!).text()) as { gold: Dictionary; silver: Dictionary };
    const tokenizer = JSON.parse(await vocabFile().text()) as { model: { vocab: Record<string, number> } };
    return {
      g2p: new G2P(new Lexicon(lexicon.gold, lexicon.silver)),
      vocab: new Map(Object.entries(tokenizer.model.vocab)),
    };
  })().catch((e) => {
    engine = null;
    throw e;
  });
  return engine;
}

async function style(id: string): Promise<Float32Array> {
  let s = styles.get(id);
  if (!s) {
    await installVoice(id);
    const bytes = await voiceFile(id).bytes();
    s = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    styles.set(id, s);
  }
  return s;
}

/** Kokoro reads at most 510 phoneme tokens at once. */
const MAX_TOKENS = 510;

export async function phonemesFor(text: string): Promise<string> {
  return (await loadEngine()).g2p.phonemize(text);
}

/** Speaks `text` with a studio voice into a WAV file at `path`. */
export async function render(text: string, voiceId: string, path: string): Promise<{ durationMs: number }> {
  const id = voiceId.slice(STUDIO_PREFIX.length);
  const { g2p, vocab } = await loadEngine();
  const phonemes = g2p.phonemize(text);
  const tokens: number[] = [];
  for (const ch of phonemes) {
    const t = vocab.get(ch);
    if (t !== undefined) tokens.push(t);
  }
  const body = tokens.slice(0, MAX_TOKENS - 2);
  // The voice file holds one style vector per input length.
  const all = await style(id);
  const row = Math.min(Math.max(body.length, 0), 509) * 256;
  const styleRow = Array.from(all.subarray(row, row + 256));
  return Native.kokoroRender(modelFile().uri, [0, ...body, 0], styleRow, 1, path);
}
