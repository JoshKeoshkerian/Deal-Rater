import type { Metadata } from "next";

import "./privacy.css";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Curbside collects, why, and what it never touches.",
};

/**
 * Ported from `docs/privacy-policy.html`, which existed as a standalone file
 * for the Chrome Web Store listing and was not reachable from either website —
 * the old footer's "Privacy" link was `href="#"`.
 *
 * THE TEXT IS UNCHANGED except for the product name, which was still "Deal
 * Rater" throughout. Editing a privacy policy is not a formatting job, so
 * nothing else was touched. Two things it does not yet cover and should, now
 * that they exist: the email address collected for sign-in with the saved
 * evaluations attached to it, and payment data once a processor is chosen.
 */
export default function PrivacyPage() {
  return (
    <main className="wrap page prose">
      <h1 className="page-h1">Privacy policy</h1>
      <p className="updated">Last updated: 2026-07-30</p>

      <p>
        Curbside is a browser extension that evaluates a Facebook Marketplace vehicle listing you
        are actively viewing, at your request. This page describes what data the extension and its
        backend collect, why, and what they never touch.
      </p>

      <h2>Nothing happens until you click</h2>
      <p>
        The extension does not run in the background, does not poll or monitor listings, and does
        not act while you are simply browsing Marketplace. Every capture is the direct result of you
        clicking &ldquo;Capture listing&rdquo; on a page you already have open.
      </p>

      <h2>What is collected from a listing</h2>
      <p>
        When you click Capture, the extension reads the vehicle listing you are viewing &mdash;
        price, mileage, year, make, model, title status if stated, description text, photo count,
        posted date, location, and (if present in the listing) the VIN &mdash; plus the result cards
        from one comparable-listings search for that vehicle. This is sent to the Curbside backend
        to compute an expected-price assessment.
      </p>
      <p>
        Facebook Marketplace shows asking prices, not sale prices. Everything Curbside produces
        describes how similar vehicles are <em>advertised</em>, not what they actually sell for.
      </p>

      <h2>What is collected about sellers</h2>
      <p>
        Two fields, and only two: an irreversible hash of the seller&rsquo;s Facebook identifier,
        and a count of their other active vehicle listings. The extension never reads or transmits
        seller display names, profile URLs, profile photos, or account join dates.
      </p>
      <p>
        Phone numbers and email addresses that appear in a listing&rsquo;s description text are
        replaced with <code>[PHONE]</code> and <code>[EMAIL]</code> before the description ever
        leaves your browser, and are redacted again on the backend as a second check.
      </p>

      <h2>VIN decoding and recall data</h2>
      <p>
        If a listing includes a VIN, it may be sent to NHTSA&rsquo;s free, keyless vPIC and recall
        APIs to decode the vehicle&rsquo;s trim/engine/drivetrain and to check for open safety
        recalls. NHTSA does not require or receive any information about you.
      </p>

      <h2>The one AI call this product makes</h2>
      <p>
        For the &ldquo;what to check on this car&rdquo; section, the backend may send a
        vehicle&rsquo;s <strong>year, make, model, trim, and a mileage band</strong> to
        Anthropic&rsquo;s Claude API to retrieve a qualitative summary of known issues for that
        vehicle. This call never includes the listing&rsquo;s description, price, location, photos,
        VIN, or any seller information &mdash; only those five vehicle-identity fields. Responses
        are cached by that same key, so most evaluations reuse a previous answer rather than making
        a new call.
      </p>

      <h2>Data retention</h2>
      <p>
        Captured listing data is stored as a time-stamped record and is periodically purged after a
        fixed retention window. It is not sold, rented, or shared with third parties for advertising
        or any purpose unrelated to producing your evaluation.
      </p>

      <h2>A note on Facebook&rsquo;s terms of service</h2>
      <p>
        Collecting listing data from Facebook Marketplace with a tool like this is against
        Meta&rsquo;s terms of service, regardless of the fact that it runs in your own browser under
        your own session. Facebook may restrict or suspend your account as a result. That risk is
        yours, not the extension&rsquo;s, and you should understand it before using Curbside.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data can be sent to{" "}
        <a href="mailto:joshkeoshkerian@gmail.com">joshkeoshkerian@gmail.com</a>.
      </p>
    </main>
  );
}
