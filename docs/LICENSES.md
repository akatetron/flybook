# Licences

What Flybook ships or downloads, under which licence, and what that means for selling it. Checked on 18 Nov 2026
against each item's own source (linked). Re-check before every paid release: model cards can change.

> This is a factual summary for planning, not legal advice. Have a lawyer confirm it before you charge money.

## Voices

The code that decides what is offered is `src/tts/voices.ts` (`ALL_VOICES`, `license.commercial`). A build made with
`VITE_COMMERCIAL_BUILD=true` offers only voices marked **yes**.

### Kokoro (studio voices)

| Voices | Licence | Commercial use | Source |
| --- | --- | --- | --- |
| Heart, Bella, Nicole, Emma, Michael, Fenrir, Puck, George, Fable | Apache-2.0 (model and voice files) | Yes | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), ONNX export [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) |

### Piper (lightweight voices)

Each Piper voice's licence comes from its training data, stated on its model card.

| Voice | Model | Licence (from the model card) | Commercial use | Source |
| --- | --- | --- | --- | --- |
| Kristin | `en_US-kristin-medium` | Public domain (LibriVox recordings) | Yes | [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/kristin/medium/MODEL_CARD) |
| Joe | `en_US-joe-medium` | CC0 | Yes | [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/joe/medium/MODEL_CARD) |
| Cori | `en_GB-cori-medium` | CC BY 4.0 (Hi-Fi TTS dataset, NVIDIA) | Yes, with attribution | [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/cori/medium/MODEL_CARD) |
| Alba | `en_GB-alba-medium` | CC BY 4.0 (University of Edinburgh) | Yes, with attribution | [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/alba/medium/MODEL_CARD) |
| Northern | `en_GB-northern_english_male-medium` | CC BY-SA 4.0 (OpenSLR 83) | Yes, with attribution; adaptations of the voice must stay CC BY-SA | [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/northern_english_male/medium/MODEL_CARD) |
| Amy | `en_US-amy-medium` | **Unclear** — the card says "see URL" and points to the mimic3-voices repository, which has no licence for this voice | **Not cleared** (hidden in commercial builds) | [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/amy/medium/MODEL_CARD) |
| Alan | `en_GB-alan-medium` | **Copyright 2022 Mycroft AI, All Rights Reserved** — no licence granted | **Not cleared** (hidden in commercial builds) | [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/alan/medium/MODEL_CARD), [dataset licence](https://github.com/MycroftAI/mimic3-voices/blob/master/voices/en_UK/apope_low/LICENSE) |

**Removed** (licences forbid commercial use). Saved choices migrate automatically and the listener is told once:

| Voice | Licence | Replaced by |
| --- | --- | --- |
| Lessac (`en_US-lessac-medium`) | Blizzard Challenge 2013 research licence — non-commercial | Kristin |
| Ryan (`en_US-ryan-medium`) | CC BY-NC-SA 4.0 — non-commercial | Joe |

### Built-in "instant" voices

Provided by the visitor's browser or operating system (Web Speech API on the web, AVSpeechSynthesizer / Android
TextToSpeech in the mobile app). Flybook doesn't distribute them; their use is governed by the platform.

## Code and runtimes

| Component | Licence | Used by |
| --- | --- | --- |
| kokoro-js | Apache-2.0 | Web: Kokoro voices |
| @huggingface/transformers | Apache-2.0 | Web: loads Kokoro |
| onnxruntime-web / ONNX Runtime | MIT | Web and mobile: runs the voice models |
| phonemizer (npm) | Apache-2.0 *(but see espeak-ng below)* | Web: Kokoro pronunciation |
| @diffusionstudio/piper-wasm | MIT *(but see espeak-ng below)* | Web: Piper pronunciation |
| **espeak-ng** | **GPL-3.0-or-later** | Compiled into both packages above |
| misaki dictionaries (hexgrad) | Apache-2.0 | Mobile: Kokoro pronunciation (`shared/g2p.ts`) |
| pdf.js | Apache-2.0 | Web: PDF reading |
| PdfBox-Android (+ Bouncy Castle) | Apache-2.0 (+ MIT-style) | Mobile (Android): PDF reading |
| React, Expo, React Native | MIT | App frameworks |
| idb | ISC | Web: IndexedDB |

## espeak-ng and the GPL — decided: the web app is GPL-3.0-or-later

**The situation.** espeak-ng, which turns text into the sounds the voices pronounce, is licensed GPL-3.0. The website
doesn't install it directly: it is compiled to WebAssembly *inside* `phonemizer` (Kokoro) and
`@diffusionstudio/piper-wasm` (Piper). Those packages are labelled Apache-2.0 and MIT, but the espeak-ng code they
contain is still GPL-3.0, and the GPL applies to the combined program. Every visitor's browser downloads those files,
so the website **distributes** GPL code.

**What the GPL requires when you distribute it**, paid or free: offer the complete corresponding source of the whole
work that includes it (your app's code, under GPL-compatible terms), keep the GPL notices, and don't add restrictions
beyond the GPL. Selling is allowed; keeping the app's code closed while shipping espeak-ng is not.

**The mobile app** doesn't use espeak-ng: its Kokoro voices use the misaki dictionaries (Apache-2.0) through
`shared/g2p.ts`, and it ships no Piper voices. As it stands, the GPL question applies only to the website.

**Options:**

1. **Keep the website GPL-compatible and its source public.** Licence Flybook's web code under GPL-3.0 (or a compatible
   licence), keep the repository public, and link to it from the app. You can still take donations, sell the mobile
   app (which has no espeak-ng), or sell a paid web tier: GPL doesn't forbid charging, but anyone may copy and
   redistribute the web app's source. Cheapest; no code change.
2. **Replace the phonemizer with a permissively licensed one.** Kokoro on the web can use the same misaki-based
   pronunciation the mobile app already has (`shared/g2p.ts`, tested), removing espeak-ng from the Kokoro path. Piper
   voices expect espeak-ng phonemes, so they would need a different phonemizer or option 3. Moderate work; then the web
   code can be closed if you want.
3. **Drop Piper on the web** (and do option 2 for Kokoro). Removes espeak-ng entirely. Older phones lose the
   lightweight voices and rely on Kokoro (slow on weak CPUs) or the built-in voices.

**Decision (Nov 2026): option 1.** The web app is licensed GPL-3.0-or-later (`LICENSE`, `package.json`), its source is
public on GitHub, and the app links to it (Settings → About, Terms). Flybook is funded by donations, which the GPL
allows. All other dependencies (MIT, Apache-2.0, ISC, OFL) are compatible with GPL-3.0. The mobile app (`mobile/`)
contains no GPL code and is not covered. Revisit only if a closed-source paid web version is ever wanted (options 2–3).

## Attribution required

CC BY / CC BY-SA voices (Cori, Alba, Northern) need credit wherever they're offered. Voice Studio shows each voice's
licence with a link to its source, and this file lists them. Apache-2.0 components need their notices kept with the
app (see `mobile/THIRD_PARTY_NOTICES.md` for the mobile app).
