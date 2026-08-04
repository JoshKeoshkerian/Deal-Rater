import type { Metadata } from "next";

import { AuthProvider } from "@/components/AuthProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

import "./globals.css";

/**
 * ONE SITE NOW. The marketing page and the signed-in area used to be two Vercel
 * projects on two hostnames; they are one app with one header, one palette and
 * one session. `app.curbsidescore.com` redirects here (see next.config.mjs).
 *
 * Root metadata describes the landing page and IS indexable — the old root
 * layout set `robots: noindex` for the whole site, which was right when the
 * whole site was one private list and is wrong now. The routes that must stay
 * out of the index (/saved, /account) set it in their own layouts instead.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://curbsidescore.com"),
  title: {
    default: "Curbside — Is it the right car?",
    template: "%s — Curbside",
  },
  description:
    "Check any Facebook Marketplace car listing in one click. Fair price, scam risk, and the questions a savvy buyer would ask.",
  openGraph: {
    title: "Curbside — Is it the right car?",
    description:
      "Check any Facebook Marketplace car listing in one click. Fair price, scam risk, and the questions a savvy buyer would ask.",
    url: "https://curbsidescore.com",
    siteName: "Curbside",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Archivo is loaded on its variable width axis, because the landing
            page's headings set `font-variation-settings: "wdth"`. The old app
            layout requested static weights, which silently ignored that. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <SiteHeader />
          <div className="site-main">{children}</div>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
