import Link from "next/link";

import { BrandMark } from "@/components/BrandMark";
import { CHROME_STORE_URL, CONTACT_EMAIL } from "@/lib/links";

/**
 * Site footer. The informational-tool disclaimer and the Meta non-affiliation
 * line live here, on every page, rather than as a block of fine print in the
 * middle of the landing page. Terms is left out until a real page exists
 * rather than pointing at nothing.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <Link className="brand-link" href="/">
              <BrandMark size={26} />
              <span className="brandname">Curbside</span>
            </Link>
            <p>
              A Chrome extension that checks Facebook Marketplace car listings against comparable
              private-party listings near you.
            </p>
          </div>
          <div className="footer-cols">
            <div className="footer-col">
              <h2>Product</h2>
              <ul>
                <li>
                  <Link href="/#how">How it works</Link>
                </li>
                <li>
                  <Link href="/#features">Features</Link>
                </li>
                <li>
                  <Link href="/pricing">Pricing</Link>
                </li>
                <li>
                  <a href={CHROME_STORE_URL} target="_blank" rel="noopener">
                    Chrome Web Store
                  </a>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h2>Company</h2>
              <ul>
                <li>
                  <Link href="/#faq">FAQ</Link>
                </li>
                <li>
                  <Link href="/privacy">Privacy</Link>
                </li>
                <li>
                  <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
                </li>
                <li>
                  <Link href="/saved">Sign in</Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-legal">
          <p>
            Curbside is an informational tool for evaluating listings. It is not a purchase
            recommendation, an appraisal, or a substitute for a pre-purchase inspection and a vehicle
            history report. Prices compared are asking prices, not sale prices.
          </p>
          <p>
            Curbside is not affiliated with, endorsed by, or connected to Meta Platforms, Inc.
            &copy; {new Date().getFullYear()} Curbside.
          </p>
        </div>
      </div>
    </footer>
  );
}
