import type { Metadata } from "next";
import Link from "next/link";

import { DemoVideoButton } from "@/components/DemoVideo";
import { CONTACT_EMAIL } from "@/lib/links";
import { GUEST_FREE_EVALUATIONS, SIGNUP_BONUS_EVALUATIONS } from "@/lib/plans";

import "./welcome.css";

/**
 * Opened by the extension once, on first install (`extension/src/background/
 * index.ts`'s `onInstalled`). Without it, a new user lands back on the Chrome
 * Web Store with no idea where the extension went: it has no popup, and its
 * button only appears on a Marketplace listing.
 *
 * Not indexed and not in the sitemap -- it only makes sense right after an
 * install.
 */
export const metadata: Metadata = {
  title: "Welcome",
  description: "Curbside is installed. Here's how to check your first car.",
  robots: { index: false, follow: false },
};

const MARKETPLACE_VEHICLES_URL = "https://www.facebook.com/marketplace/category/vehicles";

function checks(n: number): string {
  return `${n} free check${n === 1 ? "" : "s"}`;
}

export default function WelcomePage() {
  const firstFree =
    GUEST_FREE_EVALUATIONS === 1 ? "Your first check" : `Your first ${checks(GUEST_FREE_EVALUATIONS)}`;

  return (
    <main className="welcome" id="main">
      <div className="wrap welcome__inner">
        <header className="welcome__head">
          <p className="welcome__pill">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="10" fill="currentColor" />
              <path
                d="M6 10.4l2.6 2.6L14 7.6"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Curbside is installed
          </p>
          <h1 className="welcome__title">You&rsquo;re all set. Let&rsquo;s check your first car.</h1>
          <p className="welcome__lede">
            {firstFree} is free, with no sign-up. It takes about a minute.
          </p>
          <div className="welcome__demo">
            <DemoVideoButton className="btn btn--ghost" location="welcome">
              Prefer to watch first? See the demo
            </DemoVideoButton>
          </div>
        </header>

        <ol className="welcome__steps">
          <li className="wstep">
            <span className="wstep__n" aria-hidden="true">
              1
            </span>
            <div className="wstep__body">
              <h2>Open any car on Facebook Marketplace</h2>
              <p>Pick a listing you&rsquo;re curious about, or one you&rsquo;re already considering.</p>
              <a
                className="btn"
                href={MARKETPLACE_VEHICLES_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Browse Marketplace cars
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </li>

          <li className="wstep">
            <span className="wstep__n" aria-hidden="true">
              2
            </span>
            <div className="wstep__body">
              <h2>
                Click <span className="wstep__chip">Evaluate Listing</span>
              </h2>
              <p>
                The button appears on the listing page, near the seller&rsquo;s Message box. Nothing
                runs until you click it.
              </p>
            </div>
          </li>

          <li className="wstep">
            <span className="wstep__n" aria-hidden="true">
              3
            </span>
            <div className="wstep__body">
              <h2>Read your result</h2>
              <p>
                In a few seconds you&rsquo;ll see how the price compares to similar cars nearby, any red
                flags, and a suggested opening offer. Like it? Save it with your email and get{" "}
                <strong>{SIGNUP_BONUS_EVALUATIONS} more free checks</strong>.
              </p>
            </div>
          </li>
        </ol>

        <section className="welcome__help" aria-labelledby="welcome-help">
          <h2 id="welcome-help">Not seeing the button?</h2>
          <ul>
            <li>
              <strong>Reload the Marketplace tab.</strong> Tabs that were already open before you
              installed need one refresh.
            </li>
            <li>
              <strong>Open a single listing,</strong> not the search results. The button only appears
              on a car&rsquo;s own page.
            </li>
            <li>
              <strong>Use Chrome on a computer.</strong> Curbside doesn&rsquo;t run in the Facebook
              app or on phones.
            </li>
          </ul>
          <p>
            Still stuck? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we&rsquo;ll
            help. Or read <Link href="/#faq">the FAQ</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
