"use client";

/**
 * Every "Add to Chrome" link on the site, so they all behave the same way.
 *
 * TWO JOBS BEYOND BEING A LINK, both for paid acquisition:
 *
 *   1. CAMPAIGN PARAMETERS GO WITH THE CLICK. An ad lands someone on
 *      `/?utm_source=quora&utm_campaign=…`; without this, the click to the
 *      Chrome Web Store drops those parameters and the store's own analytics
 *      cannot tell ad installs from organic ones. The store accepts
 *      `utm_source`, `utm_medium` and `utm_campaign`. The landing page is the
 *      first page an ad visitor sees, so the parameters are remembered for the
 *      session in case they browse to /pricing before installing.
 *
 *   2. WHICH BUTTON WAS CLICKED is sent as a Vercel Analytics custom event
 *      (`install_click`, with `location`), so the page's CTAs can be compared.
 *      A store click is not an install — see docs/paid-ad-research — but it is
 *      the last step this site can observe.
 *
 * The server render uses the bare store URL, so markup matches between server
 * and client; the parameters are attached at click time.
 */

import { track } from "@vercel/analytics";
import { useEffect } from "react";

import { CHROME_STORE_URL } from "@/lib/links";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
const STORAGE_KEY = "curbside:utm";

function readUtm(): Record<string, string> {
  const found: Record<string, string> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) found[key] = value;
    }
    if (Object.keys(found).length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(found));
      return found;
    }
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, string>) : {};
  } catch {
    return found;
  }
}

export function storeUrlWithUtm(): string {
  const utm = readUtm();
  if (Object.keys(utm).length === 0) return CHROME_STORE_URL;
  const url = new URL(CHROME_STORE_URL);
  for (const [key, value] of Object.entries(utm)) url.searchParams.set(key, value);
  return url.toString();
}

function ChromeGlyph() {
  // A generic puzzle-piece "extension" glyph — deliberately not the Chrome logo.
  return (
    <svg className="btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 3.5a2 2 0 0 1 4 0V5h3a2 2 0 0 1 2 2v3h-1.5a2 2 0 0 0 0 4H19v3a2 2 0 0 1-2 2h-3v-1.5a2 2 0 0 0-4 0V19H7a2 2 0 0 1-2-2v-3h1.5a2 2 0 0 0 0-4H5V7a2 2 0 0 1 2-2h3V3.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InstallButton({
  location,
  className = "btn",
  children,
  icon = true,
}: {
  /** Where on the site this button sits, for the click event. */
  location: string;
  className?: string;
  children: React.ReactNode;
  icon?: boolean;
}) {
  // Capture the landing URL's parameters on first render, not only on click,
  // so they survive an in-site navigation that drops the query string.
  useEffect(() => {
    readUtm();
  }, []);

  return (
    <a
      className={className}
      href={CHROME_STORE_URL}
      target="_blank"
      rel="noopener"
      onClick={(event) => {
        event.currentTarget.href = storeUrlWithUtm();
        try {
          track("install_click", { location });
        } catch {
          // Analytics must never block the install.
        }
      }}
    >
      {icon && <ChromeGlyph />}
      {children}
    </a>
  );
}
