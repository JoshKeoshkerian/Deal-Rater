/**
 * Referral links: `curbsidescore.com/?ref=CODE`.
 *
 * The code has to survive a trip through the Chrome Web Store and an install
 * before anyone signs up, and nothing on that path carries a query string. So
 * it is put in a cookie scoped to `.curbsidescore.com`, which reaches
 * `api.curbsidescore.com` on the sign-in call from BOTH places someone can
 * sign up: this site (every request sends credentials) and the extension (its
 * verify call does too). The backend reads it there — see
 * `backend/app/referrals/service.py` for when it actually pays out.
 *
 * Not httpOnly, and doesn't need to be: a referral code is meant to be shared.
 */

/** Must match `referral_cookie_name` in `backend/app/config.py`. */
export const REFERRAL_COOKIE = "curbside_ref";

/** Long enough to cover "saw it today, installed at the weekend". */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Same shape the backend accepts (`normalize_referral_code`); anything else is dropped here. */
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/**
 * `.curbsidescore.com` in production, so the API host can read it. Host-only
 * anywhere else (localhost, Vercel previews), where a Domain attribute for a
 * different site would make the browser reject the cookie outright.
 */
function cookieDomain(hostname: string): string | null {
  return hostname === "curbsidescore.com" || hostname.endsWith(".curbsidescore.com")
    ? ".curbsidescore.com"
    : null;
}

/**
 * Store `?ref=` from the current URL, then remove it from the address bar so
 * a visitor who copies the link to send on doesn't pass the referrer's code
 * along as their own. Most recent link wins. Returns the code it stored.
 */
export function captureReferralFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("ref");
    if (raw === null) return null;

    const code = normalizeReferralCode(raw);
    if (code) {
      const parts = [
        `${REFERRAL_COOKIE}=${code}`,
        "Path=/",
        `Max-Age=${MAX_AGE_SECONDS}`,
        "SameSite=Lax",
      ];
      const domain = cookieDomain(url.hostname);
      if (domain) parts.push(`Domain=${domain}`);
      if (url.protocol === "https:") parts.push("Secure");
      document.cookie = parts.join("; ");
    }

    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return code;
  } catch {
    // Never let referral bookkeeping break a page.
    return null;
  }
}
