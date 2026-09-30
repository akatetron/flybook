import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register("./sw.js")
    .then(async () => {
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
