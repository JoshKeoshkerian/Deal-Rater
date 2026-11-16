/**
 * Small pure helpers for the sign-in form. Kept in step with the extension's
 * copies in `extension/src/content/overlay/signin-panel.ts` (two packages, no
 * shared module) -- change both together.
 */

/** Mirrors `backend/app/auth/tokens.py`'s CODE_LENGTH and CODE_ALPHABET. */
export const CODE_LENGTH = 8;
const NOT_CODE_CHARS = /[^23456789ABCDEFGHJKMNPQRSTVWXYZ]/g;

/** Upper-cased, everything outside the code alphabet dropped, at most 8 chars. */
export function canonicalCode(raw: string): string {
  return raw.toUpperCase().replace(NOT_CODE_CHARS, "").slice(0, CODE_LENGTH);
}

/** "ABCD2345" -> "ABCD-2345", the shape the email prints. */
export function formatCode(canonical: string): string {
  return canonical.length > 4 ? `${canonical.slice(0, 4)}-${canonical.slice(4)}` : canonical;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outlook.co": "outlook.com",
  "iclod.com": "icloud.com",
  "icloud.co": "icloud.com",
};

/** "jo@gmial.com" -> "jo@gmail.com", or null when nothing looks mistyped. */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const fix = DOMAIN_TYPOS[email.slice(at + 1).toLowerCase()];
  return fix ? `${email.slice(0, at + 1)}${fix}` : null;
}

/** A link straight to the inbox for the common providers, or null. */
export function webmailFor(email: string): { label: string; url: string } | null {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return {
      label: "Open Gmail",
      url: "https://mail.google.com/mail/u/0/#search/curbside+sign-in+code+in%3Aanywhere",
    };
  }
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) {
    return { label: "Open Outlook", url: "https://outlook.live.com/mail/0/" };
  }
  if (/^(yahoo|ymail)\./.test(domain)) {
    return { label: "Open Yahoo Mail", url: "https://mail.yahoo.com/" };
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return { label: "Open iCloud Mail", url: "https://www.icloud.com/mail" };
  }
  return null;
}
