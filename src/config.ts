// Site-wide settings that change without code changes elsewhere.

/** Where "Buy me a coffee" and the PayPal link go. Replace here to change them everywhere in the app. */
export const SUPPORT_LINKS = {
  coffee: { label: "Buy Me a Coffee", url: "https://buymeacoffee.com/akatetron" },
  paypal: { label: "PayPal (@Panchal28)", url: "https://paypal.me/Panchal28" },
} as const;
