import Link from "next/link";

import { Reveal } from "@/components/Reveal";
import { PLANS, FREE_EVALUATIONS, formatPrice } from "@/lib/plans";
import { CHROME_STORE_URL } from "@/lib/links";

import "./landing.css";

/**
 * The landing page, ported from `curbside-site/index.html`.
 *
 * A SERVER COMPONENT, and it should stay one. The only interactive thing on
 * this page was the scroll-in observer, which now lives in `<Reveal>`; nothing
 * else here needs to run in the browser, and the marketing page is the one
 * route where first paint actually matters.
 *
 * Two substantive changes from the static original, both consequences of the
 * merge rather than redesign:
 *
 *   1. THE "FREE" CLAIM IS NOW QUALIFIED. The old copy said "Add to Chrome —
 *      free" in three places, which stops being true the moment evaluations are
 *      metered. Every CTA now names the free allowance instead, and there is a
 *      pricing section that links to the full table.
 *   2. The three screenshots were inline base64 (a 240KB HTML file). They are
 *      real files in /public/shots now, so they can be cached and lazily loaded.
 */

const SHOTS = [
  {
    src: "/shots/score-88-buy-this-one.webp",
    alt: "Curbside panel scoring a listing 88 out of 100, headed 'Strong deal'.",
    score: 88,
    tone: "good" as const,
    verdict: "Buy this one.",
    note: "Clean title, asking below the comparable range, and nothing dragging it down. Sixteen days listed, so there's still moderate room to negotiate.",
  },
  {
    src: "/shots/score-75-cheap-for-a-reason.webp",
    alt: "Curbside panel scoring a rebuilt-title listing 75 out of 100, with vehicle risk at 25.",
    score: 75,
    tone: "mid" as const,
    verdict: "Cheap for a reason.",
    note: "The title is rebuilt, which drops vehicle risk to 25/100 — but the price is low enough to carry it. Listed 76 days, so the leverage is strong if you still want it.",
  },
  {
    src: "/shots/score-63-keep-looking.webp",
    alt: "Curbside panel scoring an older rebuilt-title listing 63 out of 100, with better-priced alternatives listed.",
    score: 63,
    tone: "low" as const,
    verdict: "Keep looking.",
    note: "Same rebuilt title, two years older, and asking more. Four comparable listings in the same search are better priced for what they are.",
  },
];

const CHECKS = [
  {
    label: "Price",
    title: "Is the ask fair?",
    body: "An expected range built from comparable listings nearby, adjusted for mileage and trim — and how far this one sits outside it.",
  },
  {
    label: "Scam",
    title: "Does it smell wrong?",
    body: "Flags the patterns real scam listings share: far below market with no reason given, thin or templated descriptions, wire-only payment, won't meet in person.",
  },
  {
    label: "Vehicle",
    title: "What's wrong with this car?",
    body: "Open safety recalls, complaint density for this model year, and title flags — salvage, rebuilt, branded — from free federal NHTSA data.",
  },
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
    body: "One install. Curbside can only reach Marketplace vehicle pages — nothing else you browse.",
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

export default function LandingPage() {
  return (
    <>
      <header className="hero" id="top">
        <div className="wrap">
          <div className="herocopy">
            <span className="lbl">Chrome extension &middot; Facebook Marketplace</span>
            <h1>
              Is it the right car?
              <em>Find out in one click.</em>
            </h1>
            <p className="lede">
              Curbside checks any Facebook Marketplace car listing and tells you whether the price
              is fair, whether it looks like a scam, how much room you have to negotiate, and what
              to ask the seller.
            </p>
            <div className="herocta">
              <a className="btn btn--big" href={CHROME_STORE_URL} target="_blank" rel="noopener">
                Add to Chrome &mdash; {FREE_EVALUATIONS} free checks
              </a>
              <p className="meta">
                No card to start. Runs only when you click it.
                <br />
                Marketplace vehicle pages only.
              </p>
            </div>
          </div>
        </div>

        <div className="showcase">
          <div className="wrap wrap--wide">
            <Reveal className="showcase__intro">
              <h2>Three Corollas. Three very different answers.</h2>
              <p>
                Same car, same city, prices within $400 of each other &mdash; and the reason they
                score differently is on the screen, not hidden inside a number.
              </p>
            </Reveal>

            <Reveal className="shots">
              {SHOTS.map((shot) => (
                <figure className="shot" key={shot.src}>
                  <div className="shot__frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.src} alt={shot.alt} width={660} height={1180} loading="lazy" />
                  </div>
                  <figcaption>
                    <p className="shot__verdict">
                      <span className={`shot__num shot__num--${shot.tone}`}>{shot.score}</span>{" "}
                      {shot.verdict}
                    </p>
                    <p>{shot.note}</p>
                  </figcaption>
                </figure>
              ))}
            </Reveal>
          </div>
        </div>
      </header>

      <section className="sec" id="score">
        <div className="wrap">
          <Reveal className="sechead">
            <span className="lbl eyebrow">The score</span>
            <h2 className="sectitle">Other deal scores hide their math. This one shows it.</h2>
            <p className="secbody">
              Four readings, each weighted, each visible. You can see exactly which one pulled the
              number down and by how much &mdash; and if you disagree with a weight, you can see
              that too. <b>A number you can&rsquo;t check is a number you shouldn&rsquo;t trust.</b>
            </p>
          </Reveal>

          <Reveal className="mathgrid">
            <ul className="mathpoints">
              <li>
                <b>Price residual carries half the score</b> &mdash; how far the ask sits from what
                comparable private-party listings suggest, adjusted for mileage and trim.
              </li>
              <li>
                <b>Vehicle risk is scored separately, never folded in.</b> A rebuilt-title car
                priced low for exactly that reason is a risky car that&rsquo;s fairly priced. One
                number can&rsquo;t say both things at once.
              </li>
              <li>
                <b>Seller and scam risk stands on its own,</b> so a warning arrives as a warning
                &mdash; not as a few points quietly shaved off a total you&rsquo;d never notice.
              </li>
              <li>
                <b>Information completeness</b> rewards sellers who actually told you something, and
                marks down the listings that left you guessing.
              </li>
            </ul>
            <div className="mathcard">
              <span className="cap">2017 Corolla SE &mdash; asking $10,500</span>
              <div className="mrow">
                <span className="k">price residual</span>
                <span className="v">73 &times; 50% = 36.5</span>
              </div>
              <div className="mrow">
                <span className="k">vehicle risk</span>
                <span className="v">25 &times; 25% = &nbsp;6.3</span>
              </div>
              <div className="mrow">
                <span className="k">seller / scam</span>
                <span className="v">75 &times; 15% = 11.3</span>
              </div>
              <div className="mrow">
                <span className="k">information</span>
                <span className="v">87 &times; 10% = &nbsp;8.7</span>
              </div>
              <div className="mrow sum">
                <span className="k">total</span>
                <span className="v">62.8 &rarr; 63</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <Reveal className="sechead">
            <span className="lbl eyebrow">Why the comps matter</span>
            <h2 className="sectitle">
              Marketplace gives you a price and nothing to judge it against.
            </h2>
            <p className="secbody">
              Most price checkers compare a private-party car to <b>dealer listings</b> &mdash; cars
              carrying reconditioning markup, warranty, and lot overhead. Against that baseline
              nearly every Marketplace car looks like a steal. Curbside compares it to the only fair
              benchmark: <b>other private sellers, right now, near you.</b>
            </p>
          </Reveal>
          <Reveal className="compare">
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
          </Reveal>
        </div>
      </section>

      <section className="sec" id="what">
        <div className="wrap">
          <Reveal className="sechead">
            <span className="lbl eyebrow">What it checks</span>
            <h2 className="sectitle">Six readings on every listing.</h2>
            <p className="secbody">
              Kept separate on purpose. A risky car can be fairly priced, and a clean car can be a
              bad buy.
            </p>
          </Reveal>
          <Reveal className="feats">
            {CHECKS.map((check) => (
              <div className="feat" key={check.label}>
                <span className="lbl">{check.label}</span>
                <h3>{check.title}</h3>
                <p>{check.body}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <Reveal className="sechead">
            <span className="lbl eyebrow">How it works</span>
            <h2 className="sectitle">Three steps, then it&rsquo;s out of your way.</h2>
          </Reveal>
          <Reveal className="steps">
            {STEPS.map((step) => (
              <div className="step" key={step.title}>
                <span className="step__n" aria-hidden="true" />
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* Pricing, summarised. The full table, the FAQ and the fine print live
          on /pricing; this is the landing page's one job on the subject —
          saying the free allowance is real and what it costs after. */}
      <section className="sec" id="pricing">
        <div className="wrap">
          <Reveal className="sechead">
            <span className="lbl eyebrow">Pricing</span>
            <h2 className="sectitle">
              Your first {FREE_EVALUATIONS} checks are free. Then pay for what you use.
            </h2>
            <p className="secbody">
              Buying a car is a few weeks of your life, not a subscription you forget about. Buy a
              pack of checks, or go unlimited for the month you&rsquo;re actually shopping and stop
              when you&rsquo;re done.
            </p>
          </Reveal>

          <Reveal className="planstrip">
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
          </Reveal>

          <Reveal className="planstrip__cta">
            <Link className="btn" href="/pricing">
              See what&rsquo;s in each plan
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="sec honest">
        <div className="wrap">
          <Reveal className="sechead">
            <span className="lbl eyebrow">What we won&rsquo;t pretend</span>
            <h2 className="sectitle">
              Two limits, stated up front instead of buried in a terms page.
            </h2>
          </Reveal>
          <Reveal className="notes">
            <div className="notecard">
              <h3>It&rsquo;s a beta signal, not a rating.</h3>
              <p>
                The weights and the discount curve are starting hypotheses. They haven&rsquo;t been
                checked against a set of hand-evaluated listings yet, and until they are, treat the
                number as a reason to look closer &mdash; not a verdict.
              </p>
            </div>
            <div className="notecard notecard--teal">
              <h3>These are asking prices, not sale prices.</h3>
              <p>
                Marketplace never shows what a car actually sold for. Every figure here describes
                how comparable vehicles are advertised. That&rsquo;s a weaker claim than a
                valuation, and you should know it going in.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="sec" id="privacy">
        <div className="wrap">
          <Reveal className="sechead">
            <span className="lbl eyebrow">Privacy</span>
            <h2 className="sectitle">It runs when you click it. That&rsquo;s the whole rule.</h2>
            <p className="secbody">
              No background scanning, no monitoring searches while you&rsquo;re away, no watching
              where else you go.
            </p>
          </Reveal>
          <Reveal className="privacy">
            <div className="pcell">
              <h3>You start every check</h3>
              <p>
                Curbside reads a listing only after you click Evaluate on a page you already opened.
                It never crawls Marketplace on its own.
              </p>
            </div>
            <div className="pcell">
              <h3>Sellers stay anonymous</h3>
              <p>
                No names, no profile links, no photos, no join dates. A scrambled ID and a count of
                active listings &mdash; that&rsquo;s all that leaves your browser.
              </p>
            </div>
            <div className="pcell">
              <h3>Marketplace only</h3>
              <p>
                Permissions are scoped to Marketplace vehicle pages. Every other tab you have open
                is none of its business.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="sec final" id="install">
        <div className="wrap">
          <Reveal as="h2" className="sectitle">
            Don&rsquo;t drive an hour to find out.
          </Reveal>
          <Reveal as="p" className="secbody">
            Check the listing in one click, then decide whether it&rsquo;s worth the trip.
          </Reveal>
          <Reveal className="finalcta">
            <a className="btn btn--big" href={CHROME_STORE_URL} target="_blank" rel="noopener">
              Add Curbside to Chrome &mdash; {FREE_EVALUATIONS} free checks
            </a>
          </Reveal>
          <Reveal as="p" className="disclaimer">
            Curbside is an informational tool for evaluating listings. It is not a purchase
            recommendation, an appraisal, or a substitute for a pre-purchase inspection and a
            vehicle history report. Curbside is not affiliated with, endorsed by, or connected to
            Meta Platforms, Inc.
          </Reveal>
        </div>
      </section>
    </>
  );
}
