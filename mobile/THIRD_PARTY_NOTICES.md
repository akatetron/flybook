# Third-party notices

FlyBook for iOS and Android includes or downloads the following. Full licence texts ship with the app.

| Component | Use | Licence |
| --- | --- | --- |
| Kokoro-82M v1.0 (hexgrad), ONNX export by onnx-community | Studio voices, downloaded on first use | Apache-2.0 |
| misaki US-English dictionaries (hexgrad) — `assets/kokoro/us_lexicon.txt`, combined from `us_gold.json` and `us_silver.json`, ported rules in `shared/g2p.ts` | Pronunciation for studio voices | Apache-2.0 (see `assets/kokoro/MISAKI_LICENSE.txt`) |
| ONNX Runtime (Microsoft) | Runs the studio voice model | MIT |
| PdfBox-Android (Tom Roush), with Bouncy Castle | PDF text on Android | Apache-2.0; Bouncy Castle licence (MIT-style) |
| Expo SDK, React Native, React | App framework | MIT |

Not included: Piper voices (website only) and espeak-ng (GPL-3.0). The studio voices' pronunciation uses the misaki
dictionaries instead, so the mobile app contains no GPL code. Built-in phone voices are provided by iOS / Android, not
by FlyBook.

The six Kokoro voices the app offers (Heart, Bella, Nicole, Michael, Fenrir, Puck) are Apache-2.0 and cleared for
commercial use. Licence sources and checks: `docs/LICENSES.md` in
the repository.
