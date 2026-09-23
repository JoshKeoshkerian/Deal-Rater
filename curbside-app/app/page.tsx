import type { Metadata } from "next";
import Link from "next/link";

import { CopyLinkButton } from "@/components/CopyLinkButton";
import { ScoreSticker } from "@/components/ScoreSticker";
import { ShowcaseShots } from "@/components/ShowcaseShots";
import { PLANS, FREE_EVALUATIONS, formatPrice } from "@/lib/plans";
import { CHROME_STORE_URL } from "@/lib/links";

import "./landing.css";

/**
 * The landing page, ported from `curbside-site/index.html`, then revised for
 * accuracy against the actual backend/extension behaviour (see the per-claim
 * comments below) and restructured so the differentiator and a worked example
 * sit near the hero instead of two-thirds down the page.
 *
 * A SERVER COMPONENT, and it should stay one. `ScoreSticker` and
 * `ShowcaseShots` are the only client boundaries.
 */

export const metadata: Metadata = {
  title: "Curbside — Is it the right car?",
  description:
    "Check a Facebook Marketplace car listing against comparable private-party listings, spot warning signs, and prepare better questions and an opening offer.",
  openGraph: {
    title: "Curbside — Is it the right car?",
    description:
      "Check a Facebook Marketplace car listing against comparable private-party listings, spot warning signs, and prepare better questions and an opening offer.",
    url: "https://curbsidescore.com",
  },
  alternates: {
    canonical: "/",
  },
};

const SHOTS = [
  {
    src: "/shots/score-88-buy-this-one.webp",
    alt: "Curbside panel scoring a listing 88 out of 100, headed 'Strong deal'.",
    score: 88,
    verdict: "Worth a closer look.",
    note: "Clean title, asking below the comparable range, and nothing dragging it down. Sixteen days listed, so there's still moderate room to negotiate.",
  },
  {
    src: "/shots/score-75-cheap-for-a-reason.webp",
    alt: "Curbside panel scoring a rebuilt-title listing 75 out of 100, with vehicle risk at 25.",
    score: 75,
    verdict: "Cheap for a reason.",
    note: "The title is rebuilt, which drops vehicle risk to 25/100 — but the price is low enough to carry it. Listed 76 days, so the leverage is strong if you still want it.",
  },
  {
    src: "/shots/score-63-keep-looking.webp",
    alt: "Curbside panel scoring an older rebuilt-title listing 63 out of 100, with better-priced alternatives listed.",
    score: 63,
    verdict: "Keep looking.",
    note: "Same rebuilt title, two years older, and asking more. Four comparable listings in the same search are better priced for what they are.",
  },
];

// The three dimensions that feed the weighted score (see COROLLA below) plus
// Information, which the score uses but doesn't get its own card here — the
// intro line in the "what" section points back at the hero/score breakdown
// for it instead of implying a fourth card exists.
const SCORED_CHECKS = [
  {
    label: "Price",
    title: "Is the ask fair?",
    body: "An expected range built from comparable listings nearby, adjusted for mileage and trim — and how far this one sits outside it.",
  },
  {
    label: "Seller & Scam",
    title: "Does it smell wrong?",
    body: "Flags the patterns real scam listings share: far below market with no reason given, thin or templated descriptions, wire-only payment, won't meet in person.",
  },
  {
    label: "Vehicle",
    title: "What's wrong with this car?",
    // Corrected against `backend/app/nhtsa/assessment.py`: NHTSA's free API
    // returns recall CAMPAIGNS for a year/make/model, not confirmation that
    // this VIN's recalls were fixed, and complaint counts are raw (never
    // normalized — "density" overstated that). Title status comes from what
    // the listing says, not from NHTSA.
    body: "Recall campaigns issued for this model, owner complaint counts, and title flags — salvage, rebuilt, branded — from what the listing states, cross-checked against free federal NHTSA recall and complaint data.",
  },
];

const EXTRA_CHECKS = [
  {
    label: "Leverage",
    title: "How much room do you have?",
    body: "Days on the market, price drops, and seller wording that signals motivation — then an offer in three moves, and a message you can edit and send.",
  },
  {
    label: "Inspection",
    title: "What should you ask?",
    body: "The known failure modes for this model at this mileage, so you show up asking about the transmission instead of nodding at the paint.",
  },
  {
    label: "Alternatives",
    title: "Is there a better one?",
    body: "Similar cars listed nearby at better prices — because sometimes the honest answer is that the next listing down is the one you want.",
  },
];

const STEPS = [
  {
    title: "Add it to Chrome",
    body: "One install, on desktop Chrome. Curbside only acts on a Marketplace vehicle listing you open and click Evaluate on.",
  },
  {
    title: "Open a car you're considering",
    body: "Browse Marketplace the way you already do. Curbside sits quiet until you want it.",
  },
  {
    title: "Click Evaluate",
    body: "It reads the listing, pulls comparable private-party listings nearby, and returns the full read in seconds — right over the page.",
  },
];

/**
 * The worked example, static in the hero — the first thing a visitor sees.
 * `keyWarning`/`nextQuestion` are both derived directly from `rows` (Vehicle
 * is the lowest reading here), not invented detail about this fictional car —
 * see the note on `ScoreSticker` about not fabricating a comp range.
 */
const COROLLA = {
  car: "2017 Corolla SE",
  ask: "$10,500",
  total: 63,
  verdict: "Fair, not great. Worth a closer look, not a rush.",
  weightedNote: "50% price · 25% risk · 15% seller · 10% info → 62.8 → 63",
  rows: [
    { label: "Price", value: 73 },
    { label: "Vehicle", value: 25 },
    { label: "Seller", value: 75 },
    { label: "Info", value: 87 },
  ],
  keyWarning: "Lowest reading: Vehicle at 25/100 — the biggest drag on this score.",
  nextQuestion: "What's behind the Vehicle reading, before anything else.",
};

export default function LandingPage() {
  return (
    <main id="main">
      <header className="hero" id="top">
        <div className="wrap hero__inner">
          <div className="herocopy">
            <h1>
              Is it the right car?
              <em>Find out in one click.</em>
            </h1>
            <p className="lede">
              Check a Facebook Marketplace car against comparable private-party listings, spot
              warning signs, and prepare better questions and an opening offer.
            </p>
            <div className="herocta">
              <div className="herocta__row">
                <a className="btn btn--big" href={CHROME_STORE_URL} target="_blank" rel="noopener">
                  Add to Chrome &mdash; {FREE_EVALUATIONS}&nbsp;free&nbsp;checks
                </a>
                <a className="btn btn--ghost btn--big" href="#examples">
                  See an example ↓
                </a>
              </div>
              <p className="meta">
                Desktop Chrome extension. No card to start. Runs only when you click Evaluate.
              </p>
              <p className="meta meta--desktop">
                Not at your computer? <CopyLinkButton /> and open it later on desktop Chrome.
              </p>
            </div>
          </div>

          <div className="hero__art">
            <div className="hero__art-inner">
              <p className="hero__art-label">Illustrative example, not a live listing.</p>
              <ScoreSticker
                car={COROLLA.car}
                ask={COROLLA.ask}
                total={COROLLA.total}
                verdict={COROLLA.verdict}
                weightedNote={COROLLA.weightedNote}
                rows={COROLLA.rows}
                keyWarning={COROLLA.keyWarning}
                nextQuestion={COROLLA.nextQuestion}
              />
            </div>
          </div>
        </div>
      </header>

      <section className="sec" id="why">
        <div className="wrap">
          <div className="sechead">
            <h2 className="sectitle">
              Marketplace gives you a price and nothing to judge it against.
            </h2>
            <p className="secbody">
              A lot of price tools compare a private-party car to <b>dealer listings</b> &mdash;
              cars carrying reconditioning markup, warranty, and lot overhead. Against that
              baseline almost anything on Marketplace looks like a deal. Curbside compares it to{" "}
              <b>other private sellers, right now, near you,</b> instead.
            </p>
          </div>
          <div className="compare">
            <div className="col col--wrong">
              <p className="coltag lbl">Dealer benchmark</p>
              <p className="colline">&ldquo;$4,100 below market.&rdquo;</p>
              <p className="colnote">
                Measured against cars that were detailed, warrantied, and sold off a lot. That gap
                is the dealer&rsquo;s overhead, not your discount.
              </p>
            </div>
            <div className="col col--right">
              <p className="coltag lbl">Curbside benchmark</p>
              <p className="colline">&ldquo;Below what private sellers ask.&rdquo;</p>
              <p className="colnote">
                Measured against comparable listings from people just like the one you&rsquo;re
                about to message. Adjusted for mileage and trim.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="how">
        <div className="wrap">
          <div className="sechead">
            <h2 className="sectitle">Three steps, then it&rsquo;s out of your way.</h2>
          </div>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li className="step" key={step.title}>
                <span className="step__n" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sec" id="what">
        <div className="wrap">
          <div className="sechead">
            <h2 className="sectitle">Six readings on every listing.</h2>
            <p className="secbody">
              Kept separate on purpose. A risky car can be fairly priced, and a clean car can be a
              bad buy.
            </p>
            <p className="secbody">
              Price, Seller &amp; Scam, and Vehicle roll straight into your score, alongside
              Information (see the breakdown below). Leverage and Alternatives are free reads
              built from the same comparable-listings search; Inspection draws on known issues
              for the model instead &mdash; none of the three carry extra weight.
            </p>
          </div>
          <div className="feats-groups">
            <div className="feats-group">
              <span className="lbl feats-group__label">Part of your score</span>
              <div className="feats">
                {SCORED_CHECKS.map((check) => (
                  <div className="feat" key={check.label}>
                    <span className="lbl">{check.label}</span>
                    <h3>{check.title}</h3>
                    <p>{check.body}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="feats-group">
              <span className="lbl feats-group__label">Free extras</span>
              <div className="feats">
                {EXTRA_CHECKS.map((check) => (
                  <div className="feat" key={check.label}>
                    <span className="lbl">{check.label}</span>
                    <h3>{check.title}</h3>
                    <p>{check.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <details className="disclosure">
            <summary>How the score is weighted</summary>
            <div className="mathgrid">
              <ul className="mathpoints">
                <li>
                  <b>Price residual carries half the score</b> &mdash; how far the ask sits from
                  what comparable private-party listings suggest, adjusted for mileage and trim.
                </li>
                <li>
                  <b>Vehicle risk gets its own line, and its own weight in the total.</b> It&rsquo;s
                  never hidden inside the number &mdash; a rebuilt-title car priced low for exactly
                  that reason still shows up two ways: a fair price, and a risk warning that
                  isn&rsquo;t averaged away.
                </li>
                <li>
                  <b>Seller and scam risk stands on its own,</b> so a warning arrives as a warning
                  &mdash; not as a few points quietly shaved off a total you&rsquo;d never notice.
                </li>
                <li>
                  <b>Information completeness</b> rewards sellers who actually told you something,
                  and marks down the listings that left you guessing.
                </li>
              </ul>
            </div>
          </details>
        </div>
      </section>

      <div className="showcase" id="examples">
        <div className="wrap wrap--wide">
          <div className="showcase__intro">
            <p className="lbl">Illustrative examples &middot; beta scoring</p>
            <h2>Three Corollas. Three very different answers.</h2>
            <p>
              Same car, same city, prices within $400 of each other &mdash; and the reason they
              score differently is on the screen, not hidden inside a number.
            </p>
          </div>

          <ShowcaseShots shots={SHOTS} />
        </div>
      </div>

      <section className="sec honest" id="trust">
        <div className="wrap">
          <div className="sechead">
            <h2 className="sectitle">What to know before you trust the number.</h2>
            <p className="secbody">
              No background scanning, no monitoring searches while you&rsquo;re away, no watching
              where else you go.
            </p>
          </div>
          <div className="notes">
            <div className="notecard notecard--teal">
              <h3>These are asking prices, not sale prices.</h3>
              <p>
                Marketplace never shows what a car actually sold for. Every figure here describes
                how comparable vehicles are advertised. That&rsquo;s a weaker claim than a
                valuation, and you should know it going in.
              </p>
            </div>
          </div>
          <div className="privacy">
            <div className="pcell">
              <h3>You start every check</h3>
              <p>
                Curbside reads a listing only after you click Evaluate on a page you already
                opened. It never crawls Marketplace on its own.
              </p>
            </div>
            <div className="pcell">
              <h3>Seller data, minimized</h3>
              <p>
                No names, no profile links, no photos, no join dates. A scrambled ID, a count of
                active listings, and the star rating Marketplace already shows on the listing
                &mdash; that&rsquo;s what leaves your browser.
              </p>
            </div>
            <div className="pcell">
              <h3>Scoped to Marketplace</h3>
              <p>
                The extension can read Marketplace pages, but it only acts &mdash; and only sends
                anything &mdash; when you click Evaluate on a vehicle listing you&rsquo;re viewing.
                Every other tab you have open is none of its business.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing, summarised. The full table, the FAQ and the fine print live
          on /pricing; this is the landing page's one job on the subject —
          saying the free allowance is real and what it costs after. */}
      <section className="sec" id="pricing">
        <div className="wrap">
          <div className="sechead">
            <h2 className="sectitle">
              Your first {FREE_EVALUATIONS} checks are free. Then pay for what you use.
            </h2>
            <p className="secbody">
              Buying a car is a few weeks of your life, not a subscription you forget about. Buy a
              pack of checks, or go unlimited for the month you&rsquo;re actually shopping and stop
              when you&rsquo;re done.
            </p>
          </div>

          <div className="planstrip">
            <div className="planstrip__free">
              <span className="lbl">Free</span>
              <p className="planstrip__price">
                {FREE_EVALUATIONS} <span>checks</span>
              </p>
              <p className="planstrip__note">
                On install, no card. Enough to judge whether this is worth paying for.
              </p>
            </div>
            {PLANS.map((plan) => (
              <div className="planstrip__plan" key={plan.id}>
                <span className="lbl">{plan.name}</span>
                <p className="planstrip__price">
                  {formatPrice(plan.priceCents)}
                  {plan.interval === "month" && <span>/mo</span>}
                </p>
                <p className="planstrip__note">{plan.summary}</p>
              </div>
            ))}
          </div>

          <div className="planstrip__cta">
            <Link className="btn" href="/pricing">
              See what&rsquo;s in each plan
            </Link>
          </div>
        </div>
      </section>

      <section className="sec final" id="install">
        <div className="wrap">
          <h2 className="sectitle">Don&rsquo;t drive an hour to find out.</h2>
          <p className="secbody">
            Check the listing in one click, then decide whether it&rsquo;s worth the trip.
          </p>
          <div className="finalcta">
            <a className="btn btn--big" href={CHROME_STORE_URL} target="_blank" rel="noopener">
              Add Curbside to Chrome &mdash; {FREE_EVALUATIONS}&nbsp;free&nbsp;checks
            </a>
            <p className="meta final-meta">Desktop Chrome extension.</p>
          </div>
          <p className="disclaimer">
            Beta signal, not a rating: the weights are starting hypotheses that have not been
            checked against hand-evaluated listings yet. Curbside is an informational tool for
            evaluating listings. It is not a purchase recommendation, an appraisal, or a substitute
            for a pre-purchase inspection and a vehicle history report. Curbside is not affiliated
            with, endorsed by, or connected to Meta Platforms, Inc.
          </p>
        </div>
      </section>
    </main>
  );
}
