// Web-only part of the sample book: its generated cover. The story itself is
// shared with the mobile app (shared/sample.ts).
export { sampleBook } from "../../shared/sample";

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
