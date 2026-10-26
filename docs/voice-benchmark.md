# Voice benchmark

Status: **protocol only — no measurements recorded yet.** The development environment that built this version could
not reach Hugging Face, so no voice could be run there. Results must come from real devices; please fill in the
tables rather than estimating.

## Passages

The four sample passages in Voice Studio (`src/components/VoiceStudio.tsx`, `SAMPLES`):

1. Story — ordinary prose.
2. Numbers & dates — `On 3 March 2024, Dr. Patel paid $1,250.75 for 12 copies — about 8.5% more than in 1998.`
3. Legal — `See Smith v. Jones, 410 U.S. 113, 115 (1973); cf. § 2(b)(iii) of the Act, as amended.`
4. Academic — `Results (n = 42) were significant, e.g. p < 0.05; however, see Table 3 and refs. [4]–[7].`

Plus a long-session check: 20 minutes of the sample story and one real chapter of a PDF.

## Procedure (per voice, per device)

1. Clear site data. Open Voice Studio, preview passage 1: record **download size** (Storage screen) and **time to first
   audio** (tap → sound).
2. Preview passages 2–4: note mispronunciations (abbreviations, numbers, dates, citations, symbols).
3. Open a document, prepare one chapter: record the time and the **real-time factor** the engine reports.
4. Refresh the page; preview again: confirm **no new model download** (DevTools → Network shows no huggingface.co
   requests) and the Storage screen shows the model *Ready*.
5. Go offline; play the prepared chapter; confirm it plays.
6. Listen for 20 minutes: rate naturalness, pauses at sentence ends, consistency (1–5).
7. Record peak memory if the browser exposes it (Chrome Task Manager / Safari Web Inspector).

## Results

| Voice | Device / browser | Download | First audio | RTF | Pronunciation notes | Naturalness (1–5) | Pauses (1–5) | Reused after refresh | Offline playback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | |
