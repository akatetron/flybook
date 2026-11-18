import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Writes sw.js into the build, stamped with a hash of everything else the
 * build produced: each deploy gets a new service-worker cache, and the browser
 * sees a changed sw.js and installs the update.
 */
function serviceWorker(): Plugin {
  return {
    name: "flybook-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      // Worker bundles are built separately; only the app's own build emits sw.js.
      if (!Object.keys(bundle).some((f) => f.endsWith(".html"))) return;
      const hash = createHash("sha256");
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name).update(item.type === "chunk" ? item.code : item.source);
      }
      const build = hash.digest("hex").slice(0, 12);
      const template = readFileSync(new URL("./src/sw.template.js", import.meta.url), "utf8");
      this.emitFile({ type: "asset", fileName: "sw.js", source: template.replaceAll("__FLYBOOK_BUILD__", build) });
    },
  };
}

// Relative base so the built site works from any path (the flybookapp.in root,
// a GitHub Pages project folder, or a plain folder on any static host).
export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ["kokoro-js", "@huggingface/transformers"] },
});
