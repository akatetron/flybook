import { createRoot } from "react-dom/client";
import { App } from "./App";
// Typefaces are bundled with the app (SIL OFL 1.1), so it makes no requests to font services.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/literata/opsz.css";
import "./styles.css";
import { models } from "./tts/modelStore";
import { storage } from "./lib/storage";
import { watchForUpdates } from "./lib/swUpdate";
import { installGlobalHandlers } from "./lib/errors";

installGlobalHandlers();
createRoot(document.getElementById("root")!).render(<App />);

// Check which voice models are really stored (files, not flags) and how much
// space the browser gives us.
void models.ready();
void storage.refresh();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then(async (reg) => {
      watchForUpdates(reg);
      await navigator.serviceWorker.ready;
      // The service worker adds the headers that enable multi-threaded voice
      // generation, but they only apply from the next page load. Reload once
      // on the very first visit; never again, even if the browser doesn't support it.
      if (!window.crossOriginIsolated) {
        try {
          if (localStorage.getItem("flybook:coi-reload")) return;
          localStorage.setItem("flybook:coi-reload", "1");
        } catch {
          return;
        }
        location.reload();
      }
    })
    .catch(() => undefined);
}
