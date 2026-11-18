import { useEffect, useState } from "react";
import { applyUpdate, onUpdateAvailable } from "../lib/swUpdate";

/** "Update available — reload", shown when a new version has downloaded in the background. */
export function UpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => onUpdateAvailable(setAvailable), []);
  if (!available || dismissed) return null;
  return (
    <div className="update-prompt" role="status">
      <span>A new version of Flybook is ready.</span>
      <button className="btn small primary" onClick={applyUpdate}>
        Reload
      </button>
      <button className="icon-btn small" onClick={() => setDismissed(true)} aria-label="Later">
        ×
      </button>
    </div>
  );
}
