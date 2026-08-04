import Link from "next/link";

import { CONTACT_EMAIL } from "@/lib/links";

/**
 * The landing page's footer, minus its dead links. Privacy is a real route now
 * (`app/privacy/page.tsx`); Terms was an `href="#"` and is left out rather than
 * pointing at nothing, which is what it did before.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span>Curbside &copy; {new Date().getFullYear()}</span>
        <span>
          <Link href="/privacy">Privacy</Link> &middot; <Link href="/pricing">Pricing</Link>{" "}
          &middot; <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </span>
      </div>
    </footer>
  );
}
