import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { CopyLinkButton } from "@/components/CopyLinkButton";
import { DemoVideo, DemoVideoButton } from "@/components/DemoVideo";
import { InstallButton } from "@/components/InstallButton";
import { ShowcaseShots } from "@/components/ShowcaseShots";
import { CONTACT_EMAIL } from "@/lib/links";
import {
  PLANS,
  FREE_EVALUATIONS,
  SIGNUP_BONUS_EVALUATIONS,
  formatPrice,
  perCheckPrice,
} from "@/lib/plans";

import "./landing.css";

/**
 * The landing page, rebuilt for paid acquisition: one promise in the hero, the
 * real product panel beside it, then the sections a first-time visitor needs
 * in roughly the order they ask — why trust it, how it works, what it shows,
 * what it costs, and the objections (FAQ) — with the install button repeated
 * at each natural decision point.
 *
 * ACCURACY RULES CARRIED OVER FROM THE PREVIOUS VERSION, and still binding:
 *   - Comparisons are against private-party ASKING prices, never sale prices.
 *   - NHTSA data is recall campaigns and complaint counts for the model, not
 *     confirmation of a specific VIN's repair status. Title status comes from
 *     what the listing says.
 *   - No invented testimonials, user counts, ratings or savings figures.
 *   - Desktop Chrome only. Edge/other browsers are not claimed.
 *
 * A SERVER COMPONENT. `InstallButton`, `CopyLinkButton` and `ShowcaseShots`
 * are the only client boundaries.
 */

const DESCRIPTION =
  "Check any Facebook Marketplace car in one click. Compare its price to similar private-party listings near you, catch scam and title red flags, and get an opening offer.";

export const metadata: Metadata = {
  title: "Curbside — Is that Marketplace car a good deal?",
  description: DESCRIPTION,
  openGraph: {
    title: "Curbside — Is that Marketplace car a good deal?",
    description: DESCRIPTION,
    url: "https://curbsidescore.com",
  },
  alternates: {
    canonical: "/",
  },
};

/* ---------- icons: simple 24px line glyphs, drawn inline ---------- */

const ICONS = {
  tag: (
    <>
      <path d="M3 11.2V4a1 1 0 0 1 1-1h7.2a1 1 0 0 1 .7.3l8.8 8.8a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0L3.3 11.9a1 1 0 0 1-.3-.7z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 4.6-3.3 8-8 9-4.7-1-8-4.4-8-9V6l8-3z" />
      <path d="M12 8v4.5M12 15.8v.2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17v.2" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4h6v3H9z" />
      <path d="M7 5.5H5.5v15h13v-15H17" />
      <path d="M9 13.5l2 2 4-4" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h7" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.7 3.2 2.5 3.5 5.2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </>
  ),
  cursor: (
    <>
      <path d="M5 3l14 7-6 1.8L10.2 18 5 3z" />
      <path d="M13 12l5 5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
} as const;

function Icon({ name, size = 22 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.14" />
      <path
        d="M6 10.4l2.6 2.6L14 7.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- content ---------- */

const TRUST = [
  { icon: "users", text: "Compared to private sellers, not dealer lots" },
  { icon: "database", text: "Federal NHTSA recall and complaint data" },
  { icon: "cursor", text: "Runs only when you click Evaluate" },
  { icon: "lock", text: "No seller names or profiles collected" },
] as const;

const STEPS = [
  {
    title: "Add Curbside to Chrome",
    body: "One click from the Chrome Web Store. No account needed — your first check runs without signing up.",
  },
  {
    title: "Open any car on Marketplace",
    body: "Browse the way you already do. Curbside stays out of the way until you want it.",
  },
  {
    title: "Click Evaluate",
    body: "Curbside pulls comparable listings nearby and shows the full read right beside the listing, in seconds.",
  },
];

const FEATURES = [
  {
    icon: "tag",
    title: "Fair price range",
    body: "An expected range built from comparable private-party listings nearby, adjusted for mileage and trim — and exactly where this ask falls in it.",
  },
  {
    icon: "shield",
    title: "Scam red flags",
    body: "Flags the patterns scam listings share: far below market with no reason, thin or templated descriptions, wire-only payment, won’t meet in person.",
  },
  {
    icon: "alert",
    title: "Recalls and title flags",
    body: "Recall campaigns and owner complaints for the model from federal NHTSA data, plus salvage, rebuilt or branded titles from what the listing states.",
  },
  {
    icon: "chat",
    title: "What to offer",
    body: "Days listed, price drops and motivated-seller wording turn into an opening offer in three moves — and a message you can edit and send.",
  },
  {
    icon: "clipboard",
    title: "What to inspect",
    body: "Known failure points for this model at this mileage, so you show up asking about the transmission instead of admiring the paint.",
  },
  {
    icon: "list",
    title: "Better alternatives",
    body: "Similar cars listed nearby at better prices — because sometimes the right answer is the next listing down.",
  },
] as const;

const SHOTS = [
  {
    src: "/shots/score-88-buy-this-one.webp",
    alt: "Curbside panel scoring a listing 88 out of 100, headed 'Strong deal'.",
    score: 88,
    verdict: "Worth a closer look.",
    note: "Clean title, asking below the comparable range, and nothing dragging it down. Sixteen days listed, so there’s still room to negotiate.",
  },
  {
    src: "/shots/score-75-cheap-for-a-reason.webp",
    alt: "Curbside panel scoring a rebuilt-title listing 75 out of 100, with vehicle risk at 25.",
    score: 75,
    verdict: "Cheap for a reason.",
    note: "The title is rebuilt, which drops vehicle risk to 25/100 — but the price is low enough to carry it. Listed 76 days, so the leverage is strong.",
  },
  {
    src: "/shots/score-63-keep-looking.webp",
    alt: "Curbside panel scoring an older rebuilt-title listing 63 out of 100, with better-priced alternatives listed.",
    score: 63,
    verdict: "Keep looking.",
    note: "Same rebuilt title, two years older, and asking more. Four comparable listings in the same search are better priced for what they are.",
  },
];

const FAQ = [
  {
    q: "Is Curbside free?",
    a: `Your first check is free with no sign-up at all. Add your email and you get ${SIGNUP_BONUS_EVALUATIONS} more free — ${FREE_EVALUATIONS} in total, no credit card. After that, buy a pack of checks that never expires (from ${formatPrice(
      PLANS[0].priceCents,
    )}) or go unlimited for ${formatPrice(PLANS[2].priceCents)} a month while you’re shopping.`,
  },
  {
    q: "Which browsers does it work on?",
    a: "Curbside is a Chrome extension for desktop and laptop computers. It doesn’t run on phones or inside the Facebook app — if you’re on your phone now, copy the link and open it on your computer.",
  },
  {
    q: "How does Curbside know what a car is worth?",
    a: "It compares the listing to similar cars currently listed by private sellers near you, adjusted for mileage and trim. Marketplace never shows what cars actually sold for, so these are asking prices — a comparison, not an appraisal.",
  },
  {
    q: "How is the score calculated?",
    a: "Price versus comparable listings carries 50% of the score, vehicle risk 25%, seller and scam risk 15%, and how complete the listing is 10%. Each one is also shown on its own, so a risk warning is never averaged away by a low price.",
  },
  {
    q: "What data does the extension collect?",
    a: "Only the listing you click Evaluate on. No seller names, profile links, photos or join dates — just a scrambled seller ID and a count of their active listings. Phone numbers and emails in descriptions are removed before anything leaves your browser.",
  },
  {
    q: "Does it replace a mechanic’s inspection?",
    a: "No. Curbside tells you which listings are worth your time and what to ask about. For a car you’re serious about, still get a pre-purchase inspection and a vehicle history report.",
  },
  {
    q: "Is Curbside affiliated with Facebook?",
    a: "No. Curbside is independent and is not affiliated with, endorsed by, or connected to Meta Platforms, Inc.",
  },
];

/* ---------- the hero visual: the real panel, beside an example listing ---------- */

function HeroProduct() {
  return (
    <figure className="product">
      <div className="product__window">
        <div className="product__bar" aria-hidden="true">
          <span className="product__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="product__url">marketplace/item/…</span>
        </div>
        <div className="product__body">
          <div className="listing" aria-hidden="true">
            {/* Photo: "2019 Toyota Corolla SE hatchback in Blizzard Pearl,
                front left" by Cutlass, Wikimedia Commons, CC0 (public domain,
                no attribution required). Resized to 800px WebP. */}
            <div className="listing__photo">
              <Image
                src="/photos/2019-corolla-se-hatchback.webp"
                alt=""
                width={800}
                height={484}
                priority
                sizes="(max-width: 980px) 40vw, 240px"
              />
            </div>
            <p className="listing__title">2019 Toyota Corolla SE Hatchback</p>
            <p className="listing__price">$10,600</p>
            <p className="listing__meta">Listed 16 days ago</p>
            <span className="listing__line" style={{ width: "92%" }} />
            <span className="listing__line" style={{ width: "78%" }} />
            <span className="listing__line" style={{ width: "64%" }} />
            <span className="listing__evaluate">Evaluate</span>
          </div>
          <div className="product__panel">
            <Image
              src="/shots/score-88-buy-this-one.webp"
              alt="Curbside result panel: 88 out of 100. 29 comparable listings suggest $10,201–$16,474; this asks $10,600. Clean title. Moderate leverage, open at $9,600."
              width={660}
              height={1180}
              priority
              sizes="(max-width: 900px) 90vw, 340px"
            />
          </div>
        </div>
      </div>
      <div className="product__chip product__chip--offer" aria-hidden="true">
        <span className="product__chip-label">Suggested opening offer</span>
        <span className="product__chip-value">$9,600</span>
      </div>
      <figcaption className="product__caption">
        Actual Curbside result. Listing shown for illustration.
      </figcaption>
    </figure>
  );
}

/* ---------- page ---------- */

export default function LandingPage() {
  return (
    <main id="main">
      {/* ---------- hero ---------- */}
      <section className="hero" id="top">
        <div className="wrap hero__inner">
          <div className="hero__copy">
            <p className="hero__pill">
              <span className="hero__pill-dot" aria-hidden="true" />
              For Facebook Marketplace car shoppers
            </p>
            <h1 className="hero__title">
              Is that Marketplace car actually a <span>good deal?</span>
            </h1>
            <p className="hero__lede">
              Curbside checks any Facebook Marketplace car in one click. See how its price compares
              to similar cars from private sellers near you, catch scam and title red flags, and get
              an opening offer you can send.
            </p>
            <div className="hero__ctas">
              <InstallButton location="hero" className="btn btn--big">
                Add to Chrome &mdash; it&rsquo;s free
              </InstallButton>
              <DemoVideoButton location="hero" />
            </div>
            <ul className="hero__checks">
              <li>
                <Check /> No sign-up to try
              </li>
              <li>
                <Check /> No credit card
              </li>
              <li>
                <Check /> Results in seconds
              </li>
            </ul>
            <p className="hero__mobile">
              On your phone? Curbside runs on desktop Chrome. <CopyLinkButton /> to open it later on
              your computer.
            </p>
          </div>
          <div className="hero__visual">
            <HeroProduct />
          </div>
        </div>
      </section>

      {/* ---------- trust strip ---------- */}
      <section className="trust" aria-label="Why Curbside">
        <ul className="wrap trust__list">
          {TRUST.map((item) => (
            <li key={item.text}>
              <span className="trust__icon">
                <Icon name={item.icon} size={20} />
              </span>
              {item.text}
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- demo video ---------- */}
      <section className="sec demo" id="demo">
        <div className="wrap">
          <div className="sechead sechead--center">
            <p className="lbl">See it in action</p>
            <h2 className="sectitle">One click. The whole picture.</h2>
            <p className="secbody">
              One click on a Marketplace car: the price against comparable listings, the red flags,
              and what to ask before you go.
            </p>
          </div>
          <div className="demo__wrap">
            <DemoVideo location="demo-section" />
          </div>
          <div className="sec__cta">
            <InstallButton location="demo-section" className="btn btn--big">
              Add to Chrome &mdash; try it free
            </InstallButton>
          </div>
        </div>
      </section>

      {/* ---------- problem / difference ---------- */}
      <section className="sec sec--subtle" id="why">
        <div className="wrap why">
          <div className="sechead">
            <p className="lbl">Why Curbside</p>
            <h2 className="sectitle">Price guides make almost every Marketplace car look like a deal.</h2>
            <p className="secbody">
              Most price tools compare a private-party car to dealer prices &mdash; cars carrying
              reconditioning, warranty and lot overhead. Curbside compares it to what{" "}
              <strong>other private sellers near you are asking right now</strong>, so you see the
              real picture.
            </p>
          </div>
          <div className="compare">
            <div className="compare__card compare__card--them">
              <p className="compare__tag">
                <span className="compare__x" aria-hidden="true">
                  ✕
                </span>
                Dealer-based price guide
              </p>
              <p className="compare__quote">&ldquo;$4,100 below market.&rdquo;</p>
              <p className="compare__note">
                Measured against cars that were detailed, warrantied and sold off a lot. That gap is
                the dealer&rsquo;s overhead, not your discount.
              </p>
            </div>
            <div className="compare__card compare__card--us">
              <p className="compare__tag">
                <Check />
                Curbside
              </p>
              <p className="compare__quote">&ldquo;Below what private sellers nearby are asking.&rdquo;</p>
              <p className="compare__note">
                Measured against comparable listings from people just like the seller you&rsquo;re
                about to message, adjusted for mileage and trim.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="sec" id="how">
        <div className="wrap">
          <div className="sechead sechead--center">
            <p className="lbl">How it works</p>
            <h2 className="sectitle">A second opinion on any listing, in three steps.</h2>
          </div>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li className="step" key={step.title}>
                <span className="step__n" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="sec__cta">
            <InstallButton location="how-it-works" className="btn btn--big">
              Add to Chrome &mdash; try it free
            </InstallButton>
          </div>
        </div>
      </section>

      {/* ---------- features ---------- */}
      <section className="sec sec--subtle" id="features">
        <div className="wrap">
          <div className="sechead sechead--center">
            <p className="lbl">What you get</p>
            <h2 className="sectitle">Everything you need to decide, on one panel.</h2>
            <p className="secbody">
              Price, vehicle risk and seller risk are scored separately &mdash; so a cheap car with a
              rebuilt title can&rsquo;t hide behind a low price.
            </p>
          </div>
          <div className="features">
            {FEATURES.map((feature) => (
              <div className="feature" key={feature.title}>
                <span className="feature__icon">
                  <Icon name={feature.icon} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- examples ---------- */}
      <section className="sec showcase" id="examples">
        <div className="wrap wrap--wide">
          <div className="sechead sechead--center">
            <p className="lbl">Real results</p>
            <h2 className="sectitle">Three Corollas. Three very different answers.</h2>
            <p className="secbody">
              Same car, same city, prices within $400 of each other &mdash; and the reason they score
              differently is right on the screen.
            </p>
          </div>
          <ShowcaseShots shots={SHOTS} />
        </div>
      </section>

      {/* ---------- pricing ---------- */}
      <section className="sec sec--subtle" id="pricing">
        <div className="wrap">
          <div className="sechead sechead--center">
            <p className="lbl">Pricing</p>
            <h2 className="sectitle">Start free. Pay only if it&rsquo;s useful.</h2>
            <p className="secbody">
              Buying a car takes a few weeks, not a lifetime. No subscription required &mdash; packs
              never expire.
            </p>
          </div>

          <div className="tiers">
            <div className="tier tier--free">
              <span className="tier__badge">Start here</span>
              <h3 className="tier__name">Free</h3>
              <p className="tier__price">
                $0 <span>{FREE_EVALUATIONS} checks</span>
              </p>
              <p className="tier__note">
                First check with no sign-up, then {SIGNUP_BONUS_EVALUATIONS} more with your email. The
                full evaluation, no card.
              </p>
              <InstallButton location="pricing-free" className="btn tier__btn" icon={false}>
                Add to Chrome
              </InstallButton>
            </div>
            {PLANS.map((plan) => {
              const unit = perCheckPrice(plan);
              return (
                <div className="tier" key={plan.id}>
                  <h3 className="tier__name">{plan.name}</h3>
                  <p className="tier__price">
                    {formatPrice(plan.priceCents)}
                    <span>{plan.interval === "month" ? "/month" : "one time"}</span>
                  </p>
                  <p className="tier__note">
                    {unit ? `${unit} per check. ` : ""}
                    {plan.summary}
                  </p>
                  <Link className="btn btn--ghost tier__btn" href="/pricing">
                    See details
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="sec" id="faq">
        <div className="wrap faq-wrap">
          <div className="sechead">
            <p className="lbl">FAQ</p>
            <h2 className="sectitle">Questions, answered.</h2>
            <p className="secbody">
              Something else? Email us and a real person will reply.
            </p>
            <p className="faq-wrap__links">
              <Link href="/privacy">Privacy policy</Link> &middot;{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </div>
          <div className="faq">
            {FAQ.map((item, index) => (
              <details className="faq__item" key={item.q} open={index === 0}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- final CTA ---------- */}
      <section className="final" id="install">
        <div className="wrap">
          <div className="final__card">
            <h2>Don&rsquo;t drive an hour to find out.</h2>
            <p>Check the listing in one click, then decide whether it&rsquo;s worth the trip.</p>
            <InstallButton location="final" className="btn btn--big final__btn">
              Add to Chrome &mdash; it&rsquo;s free
            </InstallButton>
            <p className="final__meta">
              No sign-up to try &middot; No credit card &middot; Desktop Chrome
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
