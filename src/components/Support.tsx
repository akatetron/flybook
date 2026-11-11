// The creator's support pages. Opening them is all these links do — no tracking.
export const COFFEE_URL = "https://buymeacoffee.com/akatetron";
export const PAYPAL_URL = "https://paypal.me/Panchal28";

export function CoffeeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
      <path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M8 3.5c0 1 1 1.2 1 2.2M12 3.5c0 1 1 1.2 1 2.2" />
    </svg>
  );
}

export function CoffeeButton({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`coffee-btn ${compact ? "compact" : ""}`} href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
      <CoffeeIcon />
      <span>Buy me a coffee</span>
    </a>
  );
}

/** A short, honest note on why support matters, with the button. */
export function SupportCard() {
  return (
    <section className="support-card">
      <div className="support-icon">
        <CoffeeIcon size={26} />
      </div>
      <div className="support-body">
        <h2>Enjoying Flybook?</h2>
        <p>
          Flybook is free, has no ads and never sells your data — there's no server to sell it from. It's built by one
          person. If it saved you time, a coffee keeps it growing: new voices, scanned-PDF support and the mobile app.
        </p>
        <div className="support-actions">
          <CoffeeButton />
          <a className="paypal-link" href={PAYPAL_URL} target="_blank" rel="noopener noreferrer">
            or via PayPal (@Panchal28)
          </a>
        </div>
      </div>
    </section>
  );
}
