"use client";

/**
 * One header across marketing and signed-in pages, which is the whole point of
 * merging the two properties: before this there were two, and moving between
 * them looked like leaving the site.
 *
 * The section links point at `/#how` etc. rather than `#how` so they work from
 * /pricing and /saved too — Next's router handles the same-page case without a
 * reload.
 *
 * THE MOBILE MENU CLOSES TWO WAYS. The `usePathname()` effect below closes it
 * on a real route change (or browser back/forward), but Next's router does not
 * change `pathname` for a same-page hash link — clicking "How it works" from
 * the homepage itself would otherwise leave the menu open over the section it
 * just "navigated" to. Every link/button inside the panel also closes it
 * directly, on click, which covers that case. Escape closes it too, and moves
 * focus back to the toggle button rather than leaving it wherever it lands.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/components/AuthProvider";
import { CHROME_STORE_URL } from "@/lib/links";

export function SiteHeader() {
  const { user, status, signOut, signOutError } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null);

  // Any real navigation closes the mobile menu. Without this it stays open
  // over the page it just navigated to.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    firstLinkRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const signedIn = status === "signed-in";
  const closeMenu = () => setMenuOpen(false);

  const nav = (linkRef?: RefObject<HTMLAnchorElement | null>) => (
    <>
      <Link href="/#how" className="nav-link" onClick={closeMenu} ref={linkRef}>
        How it works
      </Link>
      <Link href="/#what" className="nav-link" onClick={closeMenu}>
        What it checks
      </Link>
      <Link href="/#trust" className="nav-link" onClick={closeMenu}>
        Trust &amp; limits
      </Link>
      <Link
        href="/pricing"
        className="nav-link"
        aria-current={pathname === "/pricing" ? "page" : undefined}
        onClick={closeMenu}
      >
        Pricing
      </Link>
      {signedIn && (
        <>
          <Link
            href="/saved"
            className="nav-link"
            aria-current={pathname === "/saved" ? "page" : undefined}
            onClick={closeMenu}
          >
            Saved
          </Link>
          <Link
            href="/account"
            className="nav-link"
            aria-current={pathname === "/account" ? "page" : undefined}
            onClick={closeMenu}
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
          {nav()}

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
          {signOutError && (
            <span className="signout-note" role="status">
              {signOutError}
            </span>
          )}

          <a className="btn btn--sm" href={CHROME_STORE_URL} target="_blank" rel="noopener">
            Add to Chrome
          </a>
        </div>

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          ref={toggleRef}
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
            {nav(firstLinkRef)}
            {signedIn && user ? (
              <button type="button" className="nav-link linkish" onClick={() => { closeMenu(); void signOut(); }}>
                Sign out
              </button>
            ) : (
              <Link href="/saved" className="nav-link" onClick={closeMenu}>
                Sign in
              </Link>
            )}
            {signOutError && (
              <span className="signout-note" role="status">
                {signOutError}
              </span>
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
