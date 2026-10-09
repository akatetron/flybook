// CI check: the studio-voice files the app downloads exist, and every phoneme
// our pronunciation module can produce is in Kokoro's character map.
const REPO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
const files = ["onnx/model_quantized.onnx", "tokenizer.json", ...["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "am_puck"].map((v) => `voices/${v}.bin`)];
let failed = false;
for (const f of files) {
  const res = await fetch(`${REPO}/${f}`, { method: "HEAD", redirect: "follow" });
  const size = Number(res.headers.get("content-length") ?? res.headers.get("x-linked-size") ?? 0);
  console.log(`${res.ok ? "ok  " : "FAIL"} ${f} ${(size / 1e6).toFixed(1)} MB`);
  if (!res.ok) failed = true;
}
const vocab = (await (await fetch(`${REPO}/tokenizer.json`)).json()).model.vocab;
const produced = "AIOWYbdfhijklmnpstuvwzæðŋɑɔəɛɜɡɪɹʃʊʌʒʤʧˈˌθᵊᵻTɐ ;:,.!?—…\"“”«»";
const missing = [...produced].filter((c) => !(c in vocab));
console.log(missing.length ? `FAIL phonemes missing from vocab: ${missing.join(" ")}` : "ok   all phonemes are in the Kokoro vocab");
if (missing.length || failed) process.exit(1);
