// Site-wide settings that change without code changes elsewhere.

/** The web app's source code. It is GPL-3.0-or-later, so the app must offer it to users. */
export const SOURCE_URL = "https://github.com/akatetron/flybook";
export const LICENSE_NAME = "GPL-3.0-or-later";

/** Where "Buy me a coffee" and the PayPal link go. Replace here to change them everywhere in the app. */
export const SUPPORT_LINKS = {
  coffee: { label: "Buy Me a Coffee", url: "https://buymeacoffee.com/akatetron" },
  paypal: { label: "PayPal (@Panchal28)", url: "https://paypal.me/Panchal28" },
} as const;
