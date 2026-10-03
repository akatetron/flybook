// A short original story bundled with the app, so Flybook can be tried (or
// demoed) instantly without hunting for a PDF.
import { splitSentences, type Chapter, type Segment } from "./text";

const TITLE = "The Lighthouse Library";

const CHAPTERS: { title: string; paragraphs: string[] }[] = [
  {
    title: "Chapter One: The Keeper",
    paragraphs: [
      "At the very edge of the map, where the land gave up and the sea began, there stood a lighthouse that nobody had needed for forty years.",
      "Its keeper was a woman named Ada Fenwick. She had a crooked smile, a kettle that whistled out of tune, and more books than anyone in the village could count.",
      "Every evening, when the gulls went quiet and the tide pulled back to think, Ada climbed the hundred and twelve steps to the lamp room. She did not light the lamp. Instead, she opened a book and read aloud to the dark water.",
      "The fishermen thought she was lonely. The children thought she was a witch. Ada thought the sea deserved a good story now and then, the same as anyone.",
    ],
  },
  {
    title: "Chapter Two: The Listener",
    paragraphs: [
      "One stormy night in November, a small boat came limping out of the fog. Its sail was torn, and its only passenger was a boy of about ten, soaked to the bone and clutching a canvas bag.",
      "Ada wrapped him in a blanket, set the kettle whistling, and asked him his name. He said it was Tom, and that he had been following her voice for an hour.",
      "\"I couldn't see the shore,\" he said, \"but I could hear someone telling a story about a dragon who was afraid of the dark. So I steered toward the dragon.\"",
      "Ada laughed so hard she spilled her tea. For forty years she had thought the lamp was the lighthouse. It turned out the lighthouse had been her voice all along.",
    ],
  },
  {
    title: "Chapter Three: The Light",
    paragraphs: [
      "Tom stayed the winter. He learned which stair creaked and which book was hiding behind the flour tin. By spring, he could read aloud nearly as well as Ada.",
      "When he finally sailed home, he took a bag of books with him and a promise to read one to the sea every night, wherever he happened to be.",
      "Ada still climbs the hundred and twelve steps each evening. Some nights, if the wind is right, she is almost sure she can hear a second voice far across the water, telling the dragon story back to her.",
      "And that, the fishermen will tell you now, is why no boat has been lost on that coast in a very long time.",
    ],
  },
];

/** Book content for the sample, in the same shape a parsed PDF produces. */
export function sampleBook(): { title: string; segments: Segment[]; chapters: Chapter[]; words: number } {
  const segments: Segment[] = [];
  const chapters: Chapter[] = [];
  for (const chapter of CHAPTERS) {
    chapters.push({ title: chapter.title, start: segments.length });
    segments.push({ t: chapter.title, p: chapters.length, b: 1, h: 1 });
    for (const paragraph of chapter.paragraphs) {
      splitSentences(paragraph).forEach((t, i) => segments.push(i === 0 ? { t, p: chapters.length, b: 1 } : { t, p: chapters.length }));
    }
  }
  const words = segments.reduce((n, s) => n + s.t.split(/\s+/).length, 0);
  return { title: TITLE, segments, chapters, words };
}

/** A simple generated cover in the app's colours. */
export function sampleCover(): string | null {
  try {
    const w = 360;
    const h = 480;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#16302a");
    bg.addColorStop(1, "#0b1510");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // Light beam
    ctx.fillStyle = "rgba(233, 199, 112, 0.18)";
    ctx.beginPath();
    ctx.moveTo(180, 170);
    ctx.lineTo(360, 90);
    ctx.lineTo(360, 230);
    ctx.closePath();
    ctx.fill();
    // Lighthouse
    ctx.fillStyle = "#e9c770";
    ctx.beginPath();
    ctx.moveTo(160, 380);
    ctx.lineTo(170, 190);
    ctx.lineTo(190, 190);
    ctx.lineTo(200, 380);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(162, 168, 36, 22);
    ctx.beginPath();
    ctx.moveTo(158, 168);
    ctx.lineTo(180, 148);
    ctx.lineTo(202, 168);
    ctx.closePath();
    ctx.fill();
    // Sea
    ctx.fillStyle = "#1f4a3c";
    ctx.fillRect(0, 380, w, 100);
    // Title
    ctx.fillStyle = "#efeadc";
    ctx.textAlign = "center";
    ctx.font = "600 34px Georgia, serif";
    ctx.fillText("The Lighthouse", w / 2, 70);
    ctx.fillText("Library", w / 2, 110);
    ctx.fillStyle = "#e9c770";
    ctx.font = "16px Georgia, serif";
    ctx.fillText("A Flybook sample", w / 2, 450);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}
