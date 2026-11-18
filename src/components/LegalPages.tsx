// Privacy policy and terms. They describe what the app really does; keep them
// in step with the code (network requests: src/tts/registry.ts, Support.tsx).
//
// TODO(owner): fill in the items marked TODO before taking payments.
import { COFFEE_URL, PAYPAL_URL } from "./Support";
import { LICENSE_NAME, SOURCE_URL } from "../config";

const UPDATED = "18 November 2026";

function Todo({ children }: { children: string }) {
  return <mark className="todo">TODO: {children}</mark>;
}

function Back() {
  return (
    <a className="legal-back" href="#/settings">
      ‹ Settings
    </a>
  );
}

export function PrivacyPage() {
  return (
    <article className="screen legal">
      <Back />
      <h1>Privacy policy</h1>
      <p className="muted small">Last updated {UPDATED}</p>

      <h2>Summary</h2>
      <p>
        Flybook has no server and no accounts. Your documents, the text read from them, your notes, highlights, bookmarks and
        the audio Flybook makes stay in your browser on your device. We don't collect, receive or sell any of it.
      </p>

      <h2>Who runs Flybook</h2>
      <p>
        Flybook is run by <Todo>your full name or business name</Todo>. Contact: <Todo>contact email</Todo>.
      </p>

      <h2>What stays on your device</h2>
      <ul>
        <li>PDFs you add, the text extracted from them, your reading position and settings.</li>
        <li>Highlights, notes, bookmarks and collections.</li>
        <li>Audio prepared by the voices, and the voice model files themselves.</li>
      </ul>
      <p>
        These are stored in your browser's storage (IndexedDB and Cache Storage) for this site only. They are not uploaded
        anywhere. You can delete any of them in Flybook's Storage screen, or delete everything by clearing this site's data
        in your browser. Browsers may also remove stored data when the device is short of space.
      </p>

      <h2>Network requests Flybook makes</h2>
      <ul>
        <li>
          <strong>The app itself</strong> — from GitHub Pages (flybookapp.in), operated by GitHub. Like any web host, GitHub
          receives your IP address and browser details when the page loads; see GitHub's privacy statement.
        </li>
        <li>
          <strong>Voice files</strong> — only when you choose to download or use a voice, its model files come from Hugging
          Face (huggingface.co), which likewise receives your IP address and browser details. No text from your documents is
          sent: speech is generated on your device.
        </li>
      </ul>
      <p>
        That's all. The typefaces are bundled with the app. There is no analytics, no advertising, no tracking pixels and no
        cookies set by Flybook.
      </p>

      <h2>Built-in voices</h2>
      <p>
        If you choose an "instant" voice, your browser or operating system speaks the text. Whether it does this on the
        device or through an online service depends on your system; Flybook can't control or see that.
      </p>

      <h2>Support and payments</h2>
      <p>
        Flybook doesn't process payments. The "Buy me a coffee" links open{" "}
        <a href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
          Buy Me a Coffee
        </a>{" "}
        or{" "}
        <a href={PAYPAL_URL} target="_blank" rel="noopener noreferrer">
          PayPal
        </a>{" "}
        in a new page; anything you do there is governed by their privacy policies, and Flybook receives only what those
        services share with the recipient of a payment (such as your name and message).{" "}
        <Todo>if a payment provider for paid features is added, name it here and describe what it receives</Todo>
      </p>

      <h2>Children</h2>
      <p>Flybook collects no personal data from anyone, including children.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the new version will be published on this page with a new date.</p>
    </article>
  );
}

export function TermsPage() {
  return (
    <article className="screen legal">
      <Back />
      <h1>Terms of use</h1>
      <p className="muted small">Last updated {UPDATED}</p>

      <h2>Using Flybook</h2>
      <p>
        Flybook is provided by <Todo>your full name or business name</Todo> ("we"). You may use it to listen to, read and
        annotate documents you have the right to use. You are responsible for the documents you open in it.
      </p>

      <h2>Your content</h2>
      <p>
        Your documents, notes and audio remain yours and stay on your device. We never receive them. Back up anything
        important: browser storage can be cleared or evicted, and we can't recover it.
      </p>

      <h2>Licence and source code</h2>
      <p>
        Flybook's web app is free software, licensed under the {LICENSE_NAME}. You may use, study, share and change it
        under that licence; the complete source code is at{" "}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          {SOURCE_URL.replace("https://", "")}
        </a>
        . These terms don't restrict any right the licence gives you.
      </p>

      <h2>Voices and third-party components</h2>
      <p>
        The voices and open-source components Flybook uses are provided under their own licences, listed in the app's Voice
        Studio and in the project's licence documentation. Generated speech can contain mistakes; don't rely on it where
        accuracy is critical.
      </p>

      <h2>No warranty</h2>
      <p>
        Flybook is provided "as is", without warranties of any kind, to the extent permitted by law. We aren't liable for
        lost data or for indirect or consequential losses arising from using it.
      </p>

      <h2>Paid features</h2>
      <p>
        Flybook is currently free. <Todo>if paid features are introduced: price, billing provider, refunds and cancellation</Todo>
      </p>

      <h2>Governing law</h2>
      <p>
        <Todo>governing law and jurisdiction</Todo>
      </p>

      <h2>Contact</h2>
      <p>
        <Todo>contact email</Todo>
      </p>
    </article>
  );
}
