import type { Metadata } from "next";
import Link from "next/link";

import { PricingPlans } from "@/components/PricingPlans";
import { FREE_EVALUATIONS, SIGNUP_BONUS_EVALUATIONS } from "@/lib/plans";
import { InstallButton } from "@/components/InstallButton";

import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Try your first check with no sign-up, get three free in total, then packs from $7.99 or unlimited for $16.99 a month.`,
  openGraph: {
    title: "Pricing — Curbside",
    description: `Try your first check with no sign-up, get three free in total, then packs from $7.99 or unlimited for $16.99 a month.`,
    url: "https://curbsidescore.com/pricing",
  },
  alternates: {
    canonical: "/pricing",
  },
};

/**
 * The pricing page. Indexable, unlike /saved and /account — a price nobody can
 * find before installing is a price that does not do its job.
 *
 * The plan cards are a client component because their buttons open a dialog;
 * everything else here is static prose and stays server-rendered.
 */

const FAQ = [
  {
    q: "What counts as one check?",
    a: "One evaluation of one listing: the price read, the comparable listings, the risk flags, the negotiation brief, all of it. Re-opening a listing you already checked and reading the saved result again costs nothing.",
  },
  {
    q: "Do the packs expire?",
    a: "No. Checks sit on your account until you use them. Buying a car takes as long as it takes, and a pack with a clock on it would push you to hurry the one decision worth being slow about.",
  },
  {
    q: "What happens when I run out?",
    a: "The extension tells you, and everything you already saved stays readable. Nothing is deleted and nothing is held hostage — you just stop being able to run new checks until you top up.",
  },
  {
    q: "Why is there a subscription at all?",
    a: "Because some people are looking at ten listings a night for three weeks and packs get silly at that volume. It is meant to be cancelled when you have bought the car, and cancelling takes one click on your account page.",
  },
  {
    q: "Is saving evaluations extra?",
    a: "No. Saving, re-reading and sorting your saved list are included at every tier, including the free one.",
  },
  {
    q: "Why not just make it free?",
    a: "Each check runs a comparable-listings search, federal recall lookups and one AI call for the model-specific issues, and those cost real money per evaluation. The free allowance is sized so you can decide whether the thing is any good before paying for it.",
  },
];

export default function PricingPage() {
  return (
    <main className="wrap page" id="main">
      <header className="page-head">
        <span className="lbl eyebrow">Pricing</span>
        <h1 className="page-h1">Start free. Pay only for what you use.</h1>
        <p className="page-lede">
          Your first check needs no sign-up, and you get {FREE_EVALUATIONS} free in total with no
          credit card. After that, buy a pack that never expires or go unlimited for the month
          you&rsquo;re shopping.
        </p>
      </header>

      <section className="freeband">
        <div>
          <span className="lbl">Free to start</span>
          <p className="freeband__num">
            {FREE_EVALUATIONS} <span>checks</span>
          </p>
        </div>
        <p className="freeband__note">
          The first runs with no sign-up; add your email for {SIGNUP_BONUS_EVALUATIONS} more. The
          full evaluation, not a limited one: the same price read, risk flags, negotiation brief
          and alternatives a paid check returns.
        </p>
        <InstallButton location="pricing-page-free" className="btn">
          Add to Chrome &mdash; free
        </InstallButton>
      </section>

      <PricingPlans />

      <p className="plans__foot">
        Prices in USD. Nothing renews except the monthly plan, and that one you can cancel from{" "}
        <Link href="/account">your account</Link> at any time.
      </p>

      <section className="faq">
        <h2 className="section-h2">Questions worth asking first</h2>
        <div className="faq__grid">
          {FAQ.map((item) => (
            <div className="faq__item" key={item.q}>
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The caveats the footer and the saved list also carry. A pricing page
          is exactly where an informational score must not quietly become a
          product claim. */}
      <section className="notices">
        <p>
          <strong>Informational, not an appraisal.</strong> Curbside&rsquo;s score is an analysis
          of a listing, not a purchase recommendation, and never a substitute for a pre-purchase
          inspection or a vehicle history report.
        </p>
        <p>
          Marketplace shows asking prices, not sale prices. Every figure Curbside produces describes
          how similar vehicles were <em>advertised</em>, not what they sold for.
        </p>
      </section>
    </main>
  );
}
