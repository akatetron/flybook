// Joins saved sentence clips (16-bit PCM WAV, as the voice engines produce)
// into one WAV file for a chapter. Every input is checked; mismatched or
// malformed clips stop the export instead of producing a broken file.
export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface ParsedWav extends WavFormat {
  /** Byte offset and length of the PCM samples. */
  dataOffset: number;
  dataLength: number;
}

export class WavError extends Error {}

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export function parseWav(buf: ArrayBuffer): ParsedWav {
  const v = new DataView(buf);
  if (buf.byteLength < 44 || tag(v, 0) !== "RIFF" || tag(v, 8) !== "WAVE") throw new WavError("Not a WAV file");
  let fmt: WavFormat | null = null;
  for (let o = 12; o + 8 <= buf.byteLength; ) {
    const id = tag(v, o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt ") {
      if (v.getUint16(body, true) !== 1) throw new WavError("Only uncompressed PCM audio can be joined");
      fmt = { channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bitsPerSample: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) throw new WavError("WAV data before its format");
      return { ...fmt, dataOffset: body, dataLength: Math.min(size, buf.byteLength - body) };
    }
    o = body + size + (size % 2);
  }
  throw new WavError("WAV file has no audio data");
}

export function wavHeader(format: WavFormat, dataLength: number): ArrayBuffer {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, format.channels, true);
  v.setUint32(24, format.sampleRate, true);
  v.setUint32(28, format.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, format.bitsPerSample, true);
  str(36, "data");
  v.setUint32(40, dataLength, true);
  return buf;
}

/** One WAV from many; throws WavError on a malformed clip or a different format. */
export async function joinWavs(
  clips: Blob[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ blob: Blob; seconds: number; format: WavFormat }> {
  if (!clips.length) throw new WavError("Nothing to export");
  const parts: BlobPart[] = [];
  let format: WavFormat | null = null;
  let length = 0;
  for (const [i, clip] of clips.entries()) {
    if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    const wav = parseWav(await clip.slice(0, Math.min(clip.size, 4096)).arrayBuffer().then((head) => fullIfNeeded(head, clip)));
    if (format && (wav.sampleRate !== format.sampleRate || wav.channels !== format.channels || wav.bitsPerSample !== format.bitsPerSample)) {
      throw new WavError("These sentences were made with different audio formats (different voices?) and can't be joined");
    }
    format ??= { sampleRate: wav.sampleRate, channels: wav.channels, bitsPerSample: wav.bitsPerSample };
    // Reference the samples without copying the clip into memory again.
    parts.push(clip.slice(wav.dataOffset, wav.dataOffset + wav.dataLength));
    length += wav.dataLength;
    opts.onProgress?.(i + 1, clips.length);
  }
  if (length > 0xffffffff - 36) throw new WavError("This chapter is too long for a single WAV file");
  const f = format!;
  return {
    blob: new Blob([wavHeader(f, length), ...parts], { type: "audio/wav" }),
    seconds: length / (f.sampleRate * f.channels * (f.bitsPerSample / 8)),
    format: f,
  };
}

/** The header usually fits in the first 4 KB; if a large extra chunk pushes it further, read the whole clip. */
async function fullIfNeeded(head: ArrayBuffer, clip: Blob): Promise<ArrayBuffer> {
  try {
    parseWav(head);
    return head;
  } catch {
    return clip.arrayBuffer();
  }
}
