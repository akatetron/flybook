import { useEffect, useState } from "react";
import { onError } from "../lib/errors";

/** Shows failures the listener needs to know about (e.g. storage full). */
export function ErrorToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => onError(setMessage), []);
  if (!message) return null;
  return (
    <div className="error-toast" role="alert">
      <span>{message}</span>
      {/storage/i.test(message) && (
        <a className="btn small" href="#/storage" onClick={() => setMessage(null)}>
          Open Storage
        </a>
      )}
      <button className="icon-btn small" onClick={() => setMessage(null)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
