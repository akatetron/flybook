<div align="center">

<img src="public/icon-192.png" width="88" alt="">

# Flybook

**Listen to any PDF as an audiobook — and study it — entirely on your device.**

Natural neural voices · highlights & notes · works offline · no account · nothing uploaded

[**Open Flybook → flybookapp.in**](https://flybookapp.in/) &nbsp;·&nbsp; [☕ **Buy me a coffee**](https://buymeacoffee.com/akatetron)

![Deploy](https://github.com/akatetron/flybook/actions/workflows/deploy.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-45%20unit%20%C2%B7%2018%20browser-2e7d5b)
![Privacy](https://img.shields.io/badge/server-none-16241b)

<br>

<img src="docs/screenshots/listen.png" width="210" alt="Listening to a book">&nbsp;
<img src="docs/screenshots/read.png" width="210" alt="Reading with highlights and notes">&nbsp;
<img src="docs/screenshots/study.png" width="210" alt="Study workspace">&nbsp;
<img src="docs/screenshots/dark.png" width="210" alt="Night theme">

</div>

---

<div align="center"><img src="docs/screenshots/desktop.png" width="860" alt="Flybook on a computer"></div>

## Why Flybook

Most "PDF to speech" tools upload your document to a server. Flybook doesn't have one. The PDF is read, narrated
and annotated **inside your browser**, so private papers, contracts and books never leave your device — and once a
chapter is prepared, it plays offline.

## Features

<table>
<tr>
<td width="50%" valign="top">

### 🎧 Listen
- Neural **studio voices** (Kokoro) and **lightweight voices** (Piper) generated on your device, plus your browser's instant voices
- Prepares sentences ahead so playback doesn't stall; saved audio is never generated twice
- Queue whole chapters to prepare, each with its own voice
- Speed, sleep timer, lock-screen & headphone controls, keyboard shortcuts
- Picks up exactly where you left off
- Light on memory: idle voice engines unload themselves, and audio of chapters you've finished is cleared (optional)

</td>
<td width="50%" valign="top">

### 📖 Read & study
- Follow-along text with the spoken sentence highlighted
- Tap sentences to **highlight** (4 colours), **note**, **bookmark** or **correct the spoken text**
- **Study** screen: search and filter everything, jump back to the passage
- Export notes to **Markdown, JSON or CSV** with page references
- Group documents into **collections** (a course, a case, a project)

</td>
</tr>
<tr>
<td valign="top">

### 🗣 Voice Studio
- Real previews on story, numbers, legal and academic passages
- Compare voices back to back, star favourites, set a default
- Each document remembers its voice
- Licence and download size shown for every voice

</td>
<td valign="top">

### 🔒 Private & offline
- No account, no server, no analytics
- **Storage** screen shows exactly what's stored, verified against the real files
- Remove voices, prepared audio or documents independently
- Export a prepared chapter as a **WAV** file

</td>
</tr>
</table>

**For research and legal reading:** optionally skip citations like `[12]` or `(Smith, 2020)` and pass over reference
lists. Web addresses are read as "link to example.com" instead of letter by letter. These change only what's
spoken — your text and notes keep everything.

<div align="center">
<img src="docs/screenshots/welcome.png" width="200" alt="Welcome">&nbsp;
<img src="docs/screenshots/voices.png" width="200" alt="Voice Studio">&nbsp;
<img src="docs/screenshots/storage.png" width="200" alt="Offline storage">
</div>

## Try it in 30 seconds

1. Open **[flybookapp.in](https://flybookapp.in/)** on your phone or computer.
2. Tap **“or try a short sample story”** — or choose any text-based PDF.
3. Press play. The first studio voice downloads once (about 92 MB); after that it's on your device.

> **Tip (iPhone):** Share → *Add to Home Screen*. Safari may clear a website's data after a week without visits;
> a home-screen app keeps it.

## Voices

| | Engine | Download | Best for |
| --- | --- | --- | --- |
| **Studio** — Heart, Bella, Nicole, Emma, Michael, Fenrir, Puck, George, Fable | Kokoro-82M | ~92 MB once, shared by all (≈326 MB GPU version on computers) | The most natural narration |
| **Lightweight** — Kristin, Joe, Cori, Alba, Northern (+ Amy, Alan: licence not cleared for commercial use) | Piper | ~60 MB per voice | Older phones |
| **Instant** | Your browser | none | Immediate playback; can't be prepared ahead |

### Measured

Real run in headless Chromium on a 3-core cloud CPU (no GPU), with a 2-page, 77-sentence README PDF:

| Step | Result |
| --- | --- |
| PDF import (text, sentences, chapters) | 1.1 s |
| First audio after pressing play, **including** the voice download | 33 s |
| Kokoro generation speed on that CPU | ≈ 0.5× real time — the app detects this and suggests pausing to build a buffer |
| Reopening after a refresh | Voice reused from the device — **0** requests to Hugging Face; audio started in 0.18 s from saved sentences |
| Network switched off | Prepared audio played offline |

Computers with WebGPU, and recent phones with a Piper voice, are typically much faster. Device results are collected
in [`docs/voice-benchmark.md`](docs/voice-benchmark.md).

## How storage works

Everything lives in your browser on this device:

| What | Where |
| --- | --- |
| Documents, reading positions, notes, original PDFs | IndexedDB `flybook` (versioned; upgrades keep your data) |
| Prepared audio & voice previews | IndexedDB `flybook-audio-2` (oldest trimmed above ~600 MB) |
| Voice models | Cache Storage — checked file by file at startup |
| The app itself | Service worker cache (`flybook-app-<build>`, replaced on each deploy), for offline use |

**Updates:** each deploy gets its own app cache. Content-hashed files load from the cache first; everything else
(the page, manifest, icons) comes from the network first, so it is never stale. When a new version has downloaded,
Flybook shows **“A new version is ready — Reload”** instead of switching mid-book.

A voice counts as installed only if its files are actually present and intact — Flybook checks the files, not a
remembered flag, and **Repair** re-downloads only damaged ones. Data normally survives refreshes and closing the
tab, but it isn't permanent: clearing site data removes it, browsers can evict it when space is short, and it isn't
shared between browsers or devices. The Storage screen can ask the browser for persistent storage.

**Network use:** the app itself (flybookapp.in, hosted on GitHub Pages; typefaces are bundled) and — only when you use a
voice — that voice's files from huggingface.co. Your documents, notes and audio are never sent anywhere.
Full details: [privacy policy](https://flybookapp.in/#/privacy) · [terms](https://flybookapp.in/#/terms).

## Run it yourself

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 45 unit tests
npm run typecheck
npm run build        # static site in dist/
npm run e2e          # 18 Playwright browser tests (desktop + phone) against dist/
```

Every push to `main` runs the unit tests, the build and the browser tests, then deploys to GitHub Pages
([`deploy.yml`](.github/workflows/deploy.yml)) at **flybookapp.in** (`public/CNAME`). Paths are relative, so `dist/`
also works from any sub-folder on any static host (a browser test checks this).

GitHub Pages can't set headers, so the service worker adds the cross-origin isolation headers that multi-threaded
voices need. `public/_headers` does the same on Netlify or Cloudflare Pages and is ignored by GitHub Pages. For Vercel,
add a `vercel.json` with those three headers (`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`) for `/(.*)`.

<details>
<summary><b>Code map</b></summary>

| Piece | File |
| --- | --- |
| PDF → lines, text-quality check (text / sparse / partly scanned / image-only) | `src/lib/pdf.ts`, `src/lib/pdfQuality.ts` |
| Paragraphs, sentences, chapters, spoken text | `shared/text.ts` |
| Citation and reference filters | `shared/narration.ts` |
| Voice model registry and file verification | `src/tts/registry.ts`, `src/tts/modelStore.ts` |
| Voice engines in Web Workers | `src/tts/kokoro*.ts`, `src/tts/piper*.ts`, `src/tts/engines.ts` |
| Playback and preparation | `src/tts/narrator.ts` |
| Library database | `src/lib/db.ts` |
| Prepared audio | `src/lib/audioStore.ts` |
| Annotations: anchors, search, export | `src/lib/annotations.ts` |
| Chapter WAV export | `src/lib/wav.ts` |
| Screens | `src/components/` |
| Native iOS / Android app (in progress) | `mobile/` |

</details>

## Limitations

- **Scanned PDFs** (images without a text layer) can't be read yet — there's no OCR. Flybook says so instead of
  failing silently; partly scanned PDFs import with a warning.
- Highlighting follows the extracted text, not the rendered PDF page (a page view is next).
- **No EPUB** support yet.
- Headings that look like body text aren't detected, so some documents get page-range chapters instead.
- Chapter export is **WAV only** (~2.9 MB per minute).
- On slower devices Kokoro generates speech slower than it plays; preparing ahead or a lightweight voice fixes this.
- iOS may pause generation while the screen is locked; already-prepared audio keeps playing.

## Support Flybook

Flybook is free, has no ads and never sells your data — there's no server to sell it from. It's built by one person.
If it saved you time, **[buy me a coffee ☕](https://buymeacoffee.com/akatetron)** (or send something via
[PayPal @Panchal28](https://paypal.me/Panchal28)) — it funds new voices, scanned-PDF support and
the mobile app. Stars, bug reports and sharing it with someone who'd find it useful help just as much.

## Licence

The Flybook web app is free software under the **GNU General Public License v3.0 or later** — see [LICENSE](LICENSE).
You may use, study, share and modify it under those terms. It has to be: its voices' pronunciation step uses
espeak-ng, which is GPL-3.0 (details in [docs/LICENSES.md](docs/LICENSES.md)). The native mobile app in `mobile/`
contains no GPL code and is not covered by this licence.

## Credits & licences

[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) via `kokoro-js` (Apache-2.0) ·
[Piper](https://github.com/rhasspy/piper) voices from [piper-voices](https://huggingface.co/rhasspy/piper-voices) —
**each voice has its own licence**, shown in Voice Studio · espeak-ng (**GPL-3.0**), compiled into the `phonemizer`
and `@diffusionstudio/piper-wasm` packages · ONNX Runtime Web (MIT) · pdf.js (Apache-2.0) · idb (ISC) · React (MIT).

Every voice's licence and source, the voices removed for licence reasons (Lessac, Ryan), and what the GPL means for
a paid version are in **[docs/LICENSES.md](docs/LICENSES.md)**.

<div align="center"><sub>Built for listening, reading and thinking — privately.</sub></div>
