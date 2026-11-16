import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Inter, Unbounded } from "next/font/google";
import Script from "next/script";

import { AuthProvider } from "@/components/AuthProvider";
import { ReferralCapture } from "@/components/ReferralCapture";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

import "./globals.css";

/**
 * One typeface, self-hosted by next/font so there is no render-blocking
 * request to Google Fonts and no layout shift when it swaps in — both of
 * which cost landing-page conversions on paid traffic.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Display face for headlines, prices and the wordmark: Unbounded, the closest
 * Google Fonts match to Hagrid (wide, geometric). Body text stays Inter —
 * a face this wide is tiring at paragraph length.
 */
const unbounded = Unbounded({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-unbounded",
});

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

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
    default: "Curbside — Is that Marketplace car a good deal?",
    template: "%s — Curbside",
  },
  description:
    "Check a Facebook Marketplace car listing against comparable private-party listings, spot warning signs, and prepare better questions and an opening offer.",
  openGraph: {
    title: "Curbside — Is that Marketplace car a good deal?",
    description:
      "Check a Facebook Marketplace car listing against comparable private-party listings, spot warning signs, and prepare better questions and an opening offer.",
    url: "https://curbsidescore.com",
    siteName: "Curbside",
    type: "website",
  },
};

/**
 * Quora Pixel base code, verbatim from Quora (DO NOT MODIFY). Base code only:
 * no Advanced Match, nothing personal is sent. The Web Store click conversion
 * ('Generic') is fired from public/utm.js.
 */
const QUORA_PIXEL = `!function(q,e,v,n,t,s){if(q.qp) return; n=q.qp=function(){n.qp?n.qp.apply(n,arguments):n.queue.push(arguments);}; n.queue=[];t=document.createElement(e);t.async=!0;t.src=v; s=document.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t,s);}(window, 'script', 'https://a.quora.com/qevents.js');
qp('init', '4ed58c68faa94daf9ccfb8610831bacd');
qp('track', 'ViewContent');`;
const QUORA_NOSCRIPT = `<img height="1" width="1" style="display:none" src="https://q.quora.com/_/ad/4ed58c68faa94daf9ccfb8610831bacd/pixel?tag=ViewContent&noscript=1"/>`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${unbounded.variable}`}>
      <head>
        {/* Quora Pixel Code (JS Helper) */}
        <script dangerouslySetInnerHTML={{ __html: QUORA_PIXEL }} />
        <noscript dangerouslySetInnerHTML={{ __html: QUORA_NOSCRIPT }} />
        {/* End of Quora Pixel Code */}
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AuthProvider>
          <SiteHeader />
          <div className="site-main">{children}</div>
          <SiteFooter />
        </AuthProvider>
        <ReferralCapture />
        <Analytics />
        {/* UTM pass-through onto Chrome Web Store links (public/utm.js). */}
        <Script src="/utm.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
