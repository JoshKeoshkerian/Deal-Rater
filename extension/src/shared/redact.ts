/**
 * Client-side contact-detail redaction (spec 8.2).
 *
 * Runs before the description leaves the browser. The backend redacts again on
 * the way in, because it cannot assume a well-behaved client, but doing it here
 * means the raw contact detail never crosses the network at all.
 *
 * Mirrors backend/app/services/redact.py; keep the two in step.
 */

export const PHONE_TOKEN = "[PHONE]";
export const EMAIL_TOKEN = "[EMAIL]";

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/gi;

const PHONE_RE = /(?<![\w-])(?:\+?1[\s.\-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.\-]*\d{3}[\s.\-]*\d{4}(?![\w-])/g;

const SPELLED_DIGIT = "(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)";
const SPELLED_PHONE_RE = new RegExp(
  `\\b(?:${SPELLED_DIGIT}[\\s.\\-]+){6,}${SPELLED_DIGIT}\\b`,
  "gi",
);

/**
 * Replace contact details with fixed tokens.
 *
 * Substitution rather than deletion: nothing in the spec consumes a phone
 * number, but "text me at ..." is a negotiation and scam signal (6.3, 6.4) that
 * lives in the surrounding phrasing. The token keeps the signal and drops the
 * detail.
 */
export function redactContactDetails(text: string | null): string | null {
  if (text === null || text === undefined) return null;
  return text
    .replace(EMAIL_RE, EMAIL_TOKEN)
    .replace(PHONE_RE, PHONE_TOKEN)
    .replace(SPELLED_PHONE_RE, PHONE_TOKEN);
}
