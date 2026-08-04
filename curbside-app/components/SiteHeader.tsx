"use client";

/**
 * One header across marketing and signed-in pages, which is the whole point of
 * merging the two properties: before this there were two, and moving between
 * them looked like leaving the site.
 *
 * The section links point at `/#score` rather than `#score` so they work from
 * /pricing and /saved too — Next's router handles the same-page case without a
 * reload.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/components/AuthProvider";
import { CHROME_STORE_URL } from "@/lib/links";

export function SiteHeader() {
  const { user, status, signOut } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Any navigation closes the mobile menu. Without this it stays open over the
  // page it just navigated to.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const signedIn = status === "signed-in";

  const nav = (
    <>
      <Link href="/#score" className="nav-link">
        The score
      </Link>
      <Link href="/#what" className="nav-link">
        What it checks
      </Link>
      <Link href="/pricing" className="nav-link" aria-current={pathname === "/pricing" ? "page" : undefined}>
        Pricing
      </Link>
      {signedIn && (
        <>
          <Link href="/saved" className="nav-link" aria-current={pathname === "/saved" ? "page" : undefined}>
            Saved
          </Link>
          <Link
            href="/account"
            className="nav-link"
            aria-current={pathname === "/account" ? "page" : undefined}
          >
            Account
          </Link>
        </>
      )}
    </>
  );

  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link className="brand-link" href="/">
          <BrandMark />
          <span className="brandname">Curbside</span>
        </Link>

        <div className="navlinks">
          {nav}

          {/* `status === "unknown"` renders neither state: the first paint of a
              marketing page should not flash "Sign in" at somebody who is. */}
          {status === "signed-out" || status === "error" ? (
            <Link href="/saved" className="nav-link nav-link--auth">
              Sign in
            </Link>
          ) : null}
          {signedIn && user ? (
            <button type="button" className="nav-link nav-link--auth linkish" onClick={() => void signOut()}>
              Sign out
            </button>
          ) : null}

          <a className="btn btn--sm" href={CHROME_STORE_URL} target="_blank" rel="noopener">
            Add to Chrome
          </a>
        </div>

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none">
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="mobile-nav" id="mobile-nav">
          <div className="wrap">
            {nav}
            {signedIn && user ? (
              <button type="button" className="nav-link linkish" onClick={() => void signOut()}>
                Sign out
              </button>
            ) : (
              <Link href="/saved" className="nav-link">
                Sign in
              </Link>
            )}
            {/* The install CTA lives in `.navlinks`, which is display:none at
                this width, so the mobile menu needs its own copy. */}
            <a className="btn btn--sm" href={CHROME_STORE_URL} target="_blank" rel="noopener">
              Add to Chrome
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
