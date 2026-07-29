/**
 * Every decision the panel makes about what to show, as pure functions.
 *
 * Nothing here touches the DOM. That is deliberate: these are the judgements
 * that were previously spread through the render pass as inline ternaries,
 * where they could not be tested and could not be found. The rendering modules
 * ask this one what state the panel is in and then draw it.
 *
 * IT DECIDES PRESENTATION, NEVER FACTS. The backend has already scored,
 * filtered, widened the interval and withheld what it will not stand behind.
 * A function here may choose to lead with a finding, subordinate it, or fold it
 * into a collapsed section. None of them may invent one, and none may hide one
 * so thoroughly that it is unreachable.
 */

import type { EvaluationResponse, ScoreComponent } from "../../shared/types";
import type { Grade, Tone } from "./tokens";

/** Sub-score spread below which the four dimensions are "all much the same". */
export const FLAT_BREAKDOWN_SPREAD = 15;

export type HeadlineState = "confident" | "unreliable";

/** Interval width over its midpoint, or null when there is no interval. */
export function intervalWidthRatio(pricing: EvaluationResponse["pricing"]): number | null {
  const low = pricing.asking_interval_low_cents;
  const high = pricing.asking_interval_high_cents;
  if (low === null || high === null) return null;
  const midpoint = (low + high) / 2;
  if (midpoint <= 0) return null;
  return (high - low) / midpoint;
}

/**
 * Which headline the panel is entitled to.
 *
 * "unreliable" is not an error state. It is the answer, and the panel should be
 * willing to give it: a large precise score sitting above the caveats that
 * invalidate it reads as confidence the evaluation does not have, and the
 * caveats lose every time.
 *
 * CONFIDENCE ALONE DECIDES THIS. An earlier version also escalated to
 * "unreliable" whenever the interval passed 35% of its own midpoint,
 * independent of confidence. That redundancy is exactly what broke it: a wide
 * interval is already one of the inputs `assess_confidence` weighs (spec
 * `pricing/confidence.py`'s WIDE_INTERVAL limiter, same 35% threshold), so
 * checking it again here meant a listing the backend had already called MEDIUM
 * -- specifically because it weighed the width and still landed on MEDIUM --
 * could get overridden back to "unreliable" by this function re-deriving the
 * same signal. Measured against ~150 real captures the two limiters that
 * dominate MEDIUM confidence are the two structural ones that fire on every
 * evaluation plus a wide interval, so this branch was firing on nearly every
 * MEDIUM-confidence listing: "this vehicle cannot be priced confidently" on
 * every capture, which is a second-guess of the backend's own verdict, not a
 * presentation decision.
 */
export function headlineState(data: EvaluationResponse): HeadlineState {
  const { confidence } = data.pricing;
  return confidence === "low" || confidence === "none" ? "unreliable" : "confident";
}

export function confidenceTone(confidence: string): Tone {
  switch (confidence) {
    case "high":
      return "favorable";
    case "medium":
      return "caution";
    default:
      return "adverse";
  }
}

/**
 * Comp-quality problems, worst first, in the panel's own words.
 *
 * TWO THINGS THIS FIXES.
 *
 * `confidence_reasons` arrives in append order, and its first two entries are
 * the structural limiters that fire on EVERY evaluation -- no recency
 * weighting, dealer filtering unavailable. Leading a headline with those would
 * say the same two sentences about every car on Marketplace. Hence
 * `confidence_limiters`, and hence this ranking: what is wrong with THIS comp
 * set, before what is wrong with all of them.
 *
 * The text is also shorter than the backend's. Its sentences are written to be
 * read at leisure in a list; these are written to be read at a glance in the
 * primary text position, and the full versions stay reachable in the caveats
 * section.
 */
const LIMITER_RANK: string[] = [
  // Disqualifying: the comp set answers a different question.
  "trim_disagreement",
  "wrong_market",
  "no_estimate",
  // Thin or unadjusted.
  "comp_count",
  "no_mileage_adjustment",
  "trim_unknown",
  "widened_year_window",
  // The fit itself is shaky.
  "outlier_sensitive",
  "weak_mileage_fit",
  "mileage_extrapolation",
  "wide_interval",
  // A finding about the listing rather than the comps.
  "adverse_selection",
  // Structural: true of every evaluation this tool will ever run.
  "dealer_filtering_unavailable",
  "no_recency_weighting",
];

function limiterText(limiter: string, pricing: EvaluationResponse["pricing"]): string {
  switch (limiter) {
    case "trim_disagreement":
      return "most comparable listings look like a different trim";
    case "wrong_market":
      return "the comparable listings are not from this vehicle's area";
    case "no_estimate":
      return "there are too few comparable listings to price this at all";
    case "comp_count":
      return pricing.comps_included === 1
        ? "only 1 comparable listing was usable"
        : `only ${pricing.comps_included} comparable listings were usable`;
    case "no_mileage_adjustment":
      return "no mileage adjustment was possible, so this is a plain median";
    case "trim_unknown":
      return "trim is unknown for most of the comparable listings";
    case "widened_year_window":
      return `the search had to widen to a ${pricing.year_window}-year window`;
    case "outlier_sensitive":
      return "one or two listings are holding up the whole estimate";
    case "weak_mileage_fit":
      return "mileage barely explains the spread in asking prices";
    case "mileage_extrapolation":
      return "this car's mileage sits outside the range the comps cover";
    case "wide_interval":
      return "the comparable asks are spread too widely to narrow";
    case "adverse_selection":
      return "the ask is far below the comps with nothing explaining why";
    case "dealer_filtering_unavailable":
      return "dealer listings could not be filtered out";
    case "no_recency_weighting":
      return "the comps carry no posted dates, so stale asks count fully";
    default:
      return limiter.replace(/_/g, " ");
  }
}

export function compProblems(
  pricing: EvaluationResponse["pricing"],
  limit = 2,
): string[] {
  const ranked = [...pricing.confidence_limiters].sort((a, b) => {
    const ai = LIMITER_RANK.indexOf(a);
    const bi = LIMITER_RANK.indexOf(b);
    return (ai === -1 ? LIMITER_RANK.length : ai) - (bi === -1 ? LIMITER_RANK.length : bi);
  });
  return ranked.slice(0, limit).map((limiter) => limiterText(limiter, pricing));
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Spec 5.1's comparison, as one sentence: what comps suggest, what this asks.
 *
 * Built here rather than taken from `headline`, which opens by restating the
 * score and the confidence level -- both of which are already on screen an inch
 * above it as a 36px number and a chip. Saying them a second time in prose
 * spends the most valuable line in the panel on nothing. Null when there is no
 * estimate, and the caller falls back to the backend's sentence, which handles
 * that case in words.
 */
export function priceComparison(pricing: EvaluationResponse["pricing"]): string | null {
  const { asking_interval_low_cents: low, asking_interval_high_cents: high } = pricing;
  const ask = pricing.ask_cents;
  if (low === null || high === null || ask === null) return null;
  return (
    `${pricing.comps_included} comparable listings suggest ` +
    `${dollars(low)}–${dollars(high)}. This asks ${dollars(ask)}.`
  );
}

/* -------------------------------------------------------------------------- */
/* the price gauge (spec 5.1's four numbers, drawn)                           */
/* -------------------------------------------------------------------------- */

/** Padding at each end, as a share of the span, so no marker sits on the edge. */
const GAUGE_PAD = 0.08;

export interface PriceGauge {
  /** The domain the scale covers, in cents. */
  min: number;
  max: number;
  /** The expected asking interval, as 0-1 positions. Null when there is none. */
  band: { start: number; end: number } | null;
  /** 0-1 positions for each of spec 5.1's figures. Null when not published. */
  ask: number | null;
  strongOffer: number | null;
  walkAway: number | null;
  /** Where the ask falls relative to the interval, as a judgement. */
  askTone: Tone;
}

/**
 * Spec 5.1's four numbers on one scale.
 *
 * The point of drawing them is that the four are only meaningful in relation to
 * each other: "$14,900" answers nothing, and "$14,900 against an expected
 * $13,800-$14,300, walk away above $14,600" is four figures a reader has to
 * hold in their head at once to see that the ask is over the line. The scale
 * holds them instead.
 *
 * Null when there is no interval to anchor it: without the band this is a
 * number line with one point on it, which is a decoration.
 */
export function priceGauge(pricing: EvaluationResponse["pricing"]): PriceGauge | null {
  const low = pricing.asking_interval_low_cents;
  const high = pricing.asking_interval_high_cents;
  if (low === null || high === null || high < low) return null;

  const ask = pricing.ask_cents;
  const strong = pricing.strong_offer_cents;
  const walk = pricing.walk_away_above_cents;

  const values = [low, high, ask, strong, walk].filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // A degenerate span (every figure identical) would divide by zero. Give it an
  // arbitrary but stable width so the marks stack in the middle rather than
  // producing NaN positions.
  const span = rawMax - rawMin || Math.max(rawMax * 0.1, 1);
  const min = rawMin - span * GAUGE_PAD;
  const max = rawMax + span * GAUGE_PAD;

  const at = (value: number | null): number | null =>
    value === null ? null : (value - min) / (max - min);

  return {
    min,
    max,
    band: { start: at(low)!, end: at(high)! },
    ask: at(ask),
    strongOffer: at(strong),
    walkAway: at(walk),
    askTone: askTone(ask, low, high, walk),
  };
}

/**
 * How the ask reads against the interval.
 *
 * Deliberately NOT the pricing sub-score restated: this is the crude
 * over/under/inside reading, and it exists so the marker on the scale is
 * coloured by the same rule a reader would apply looking at where it sits.
 * Spec 2's point -- that far under the range is a warning rather than a
 * bargain -- is the scoring model's job and is already in `price_residual`.
 */
function askTone(
  ask: number | null,
  low: number,
  high: number,
  walkAway: number | null,
): Tone {
  if (ask === null) return "neutral";
  if (walkAway !== null && ask > walkAway) return "adverse";
  if (ask > high) return "caution";
  if (ask < low) return "favorable";
  return "neutral";
}

/**
 * A comp's price against the target's, as a signed figure and a judgement.
 *
 * Used by the alternatives cards, where the whole question a reader has is
 * "cheaper than the one I am looking at, and by how much". `null` when either
 * price is missing, in which case the card prints the price alone.
 */
export function priceDelta(
  candidateCents: number | null,
  askCents: number | null,
): { text: string; tone: Tone } | null {
  if (candidateCents === null || askCents === null) return null;
  const difference = Math.round((candidateCents - askCents) / 100);
  if (difference === 0) return { text: "same price", tone: "neutral" };
  const amount = `$${Math.abs(difference).toLocaleString("en-US")}`;
  return difference < 0
    ? { text: `${amount} less`, tone: "favorable" }
    : { text: `${amount} more`, tone: "caution" };
}

/**
 * The vehicle out of an alternative's description line.
 *
 * `alternatives/finder.py` builds one string with everything in it --
 * "2016 Mazda CX-5 - $12,400, 86,000 mi, Tulsa, OK  [better value by 12%...]"
 * -- while ALSO sending price, mileage, location and advantage as their own
 * fields. The card renders the fields, so printing the line as well would say
 * each of them twice. The vehicle is the one part with no field of its own,
 * hence this: take the segment before the first " - " and leave the rest.
 *
 * Falls back to the whole line if the separator is not there, which is the
 * right failure -- a card headed by a slightly long string still tells a buyer
 * what the car is, and one headed by nothing does not.
 */
export function alternativeVehicle(description: string): string {
  const [head] = description.split(" - ");
  const trimmed = head?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : description;
}

/* -------------------------------------------------------------------------- */
/* negotiation (spec 6.4, 7.5)                                                */
/* -------------------------------------------------------------------------- */

export function leverageTone(leverage: string): Tone {
  if (leverage === "strong") return "favorable";
  if (leverage === "moderate") return "caution";
  return "neutral";
}

/**
 * Day counts the time-on-market track draws its zones from.
 *
 * MIRRORS `backend/app/negotiation/params.py`. Duplicated rather than sent on the
 * wire, the same way `LOW_RATING_THRESHOLD` and `SCAM_SIGNAL_TEXT` in
 * `sections.ts` are: these are the graphic's own axis, and a track whose zones
 * arrive over the network cannot be drawn until they do. If the backend's bands
 * move, this moves with them.
 */
const FRESH_DAYS = 1;
const ESTABLISHED_DAYS = 14;
const STALE_DAYS = 30;
const VERY_STALE_DAYS = 75;

/** Where the track's axis ends when the listing has not run past it. */
const TRACK_DEFAULT_MAX_DAYS = 90;

export interface TimeOnMarketMark {
  /** 0-1 position along the track. */
  position: number;
  label: string;
}

export interface TimeOnMarketTrack {
  days: number;
  /** 0-1 position of the listing's own marker. */
  position: number;
  marks: TimeOnMarketMark[];
  /** What this many days means, in words. */
  phase: string;
}

/**
 * Days listed, drawn on an axis instead of scored out of 100.
 *
 * WHY THIS REPLACED A METER. The section led with `strength` as "Negotiating room
 * 62/100" -- an uncalibrated composite that starts at 30 and tops out around 83,
 * so it was neither a percentage nor a measurement, and it was the most
 * confident-looking element in the panel. Days listed is the underlying fact, it
 * is observed rather than derived, and on an axis with the thresholds marked it
 * answers the same question honestly: a dot past the 30-day mark says more than
 * any score can.
 *
 * Null when there is no posted date. That is absence of evidence, and drawing a
 * marker at zero would render it as a listing posted today -- the opposite
 * reading.
 */
export function timeOnMarketTrack(daysListed: number | null): TimeOnMarketTrack | null {
  if (daysListed === null || daysListed < 0) return null;

  // The axis grows for a listing that has outrun it, so a 200-day car does not
  // pin to the end and read the same as a 90-day one.
  const maxDays = Math.max(TRACK_DEFAULT_MAX_DAYS, Math.ceil(daysListed * 1.15));
  const at = (days: number) => Math.max(0, Math.min(1, days / maxDays));

  return {
    days: daysListed,
    position: at(daysListed),
    marks: [
      { position: at(ESTABLISHED_DAYS), label: `${ESTABLISHED_DAYS}d` },
      { position: at(STALE_DAYS), label: `${STALE_DAYS}d` },
      { position: at(VERY_STALE_DAYS), label: `${VERY_STALE_DAYS}d` },
    ],
    phase: timeOnMarketPhase(daysListed),
  };
}

function timeOnMarketPhase(days: number): string {
  if (days < FRESH_DAYS) return "just listed, so everyone who saw it is still looking";
  if (days < ESTABLISHED_DAYS) return "still fresh, and early interest has not passed";
  if (days < STALE_DAYS) return "past the first rush of interest";
  if (days < VERY_STALE_DAYS) return "sat longer than a car that is priced right usually does";
  return "unsold for months at this price";
}

export interface OfferStep {
  label: string;
  cents: number;
  /** The figure the buyer says first, sized and toned to be read first. */
  lead: boolean;
  tone: Tone;
}

/**
 * Spec 7.5's offer as an ordered ladder, or null when there is nothing to draw.
 *
 * WHY A LADDER AND NOT A FIGURE. The section showed one number labelled
 * "Suggested offer", which does not say whether it is the opening move or the
 * target. A buyer who opens at their own target settles above it, because a seller
 * who splits the difference splits it upward -- so the single figure was not just
 * incomplete, it was costing money.
 *
 * The steps COLLAPSE when two figures are equal. On a listing already asking below
 * what the comps support the backend sets opening and target to the same number,
 * and printing "Open at $12,450 / Expect to pay $12,450" twice reads as a bug
 * rather than as the finding that there is nothing to argue down.
 */
export function offerLadder(negotiation: EvaluationResponse["negotiation"]): OfferStep[] | null {
  const { offer } = negotiation;
  const opening = offer.opening_cents;
  const target = offer.target_cents;
  if (opening === null || target === null) return null;

  const tone = leverageTone(negotiation.leverage);
  const steps: OfferStep[] = [];

  if (opening === target) {
    steps.push({
      label: offer.stance === "pay_near_asking" ? "Offer their ask" : "Offer",
      cents: opening,
      lead: true,
      tone,
    });
  } else {
    steps.push({ label: "Open at", cents: opening, lead: true, tone });
    steps.push({
      label: offer.stance === "pay_near_asking" ? "Their ask" : "Expect to pay",
      cents: target,
      lead: false,
      tone: "neutral",
    });
  }

  if (offer.walk_away_cents !== null) {
    steps.push({
      label: "Walk away above",
      cents: offer.walk_away_cents,
      lead: false,
      tone: "caution",
    });
  }
  return steps;
}

/** The stance as a chip: what shape of negotiation this is. */
export function offerStanceChip(stance: string): { tone: Tone; label: string } | null {
  switch (stance) {
    case "negotiate":
      return { tone: "favorable", label: "room to negotiate" };
    case "pay_near_asking":
      return { tone: "caution", label: "little to argue down" };
    case "stretch":
      return { tone: "adverse", label: "asking well over the comps" };
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* score breakdown                                                            */
/* -------------------------------------------------------------------------- */

export interface Contribution {
  component: ScoreComponent;
  /** Points this dimension puts into the final 0-100 score. */
  points: number | null;
  /** The most it could have contributed, i.e. its renormalised weight. */
  maxPoints: number;
}

/**
 * Reading order for the four dimensions -- fixed, regardless of score or
 * which ones could even be assessed. Rows used to sort by contribution
 * (highest points first), which meant the same dimension moved from listing
 * to listing depending on how it scored. A reader checking "what's the
 * vehicle risk on this one" needs it in the same place every time; a panel
 * that reshuffles itself is not scannable.
 */
const DIMENSION_ORDER = [
  "price_residual",
  "vehicle_risk",
  "seller_and_scam_risk",
  "information_completeness",
] as const;

/**
 * What each dimension actually contributed, in fixed reading order.
 *
 * The bars used to be drawn from the raw sub-score, so information
 * completeness -- 9% of the number -- drew the same length as price residual at
 * 56%. A reader comparing bar lengths was comparing nothing. Length is now
 * weight x sub-score, renormalised over the dimensions that could be assessed,
 * which is exactly how `compute_deal_score` arrives at the headline: the
 * contributions sum to the score. That renormalisation still varies by
 * listing; the order of the rows themselves no longer does.
 */
export function contributions(components: ScoreComponent[]): Contribution[] {
  const available = components.filter((c) => c.value !== null);
  const covered = available.reduce((sum, c) => sum + c.weight, 0);

  const rows = components.map((component) => {
    const maxPoints = covered > 0 ? (component.weight / covered) * 100 : 0;
    const points =
      component.value === null || covered <= 0 ? null : (maxPoints * component.value) / 100;
    return { component, points, maxPoints };
  });

  return rows.sort((a, b) => {
    const orderOf = (name: string) => {
      const index = DIMENSION_ORDER.indexOf(name as (typeof DIMENSION_ORDER)[number]);
      return index === -1 ? DIMENSION_ORDER.length : index;
    };
    return orderOf(a.component.name) - orderOf(b.component.name);
  });
}

/**
 * True when the sub-scores are too close together for "what dragged this
 * down?" to have an answer. The bars still render either way; this only gates
 * whether `breakdownSummary` has a sentence to add above them or nothing to
 * say at all.
 */
export function breakdownIsFlat(components: ScoreComponent[]): boolean {
  const values = components
    .map((c) => c.value)
    .filter((value): value is number => value !== null);
  if (values.length < 2) return false;
  return Math.max(...values) - Math.min(...values) <= FLAT_BREAKDOWN_SPREAD;
}

/** Sub-score tone. Uncalibrated, like the scores themselves (spec 9). */
export function scoreTone(value: number | null): Tone {
  if (value === null) return "neutral";
  if (value >= 70) return "favorable";
  if (value >= 45) return "caution";
  return "adverse";
}

/**
 * The headline score's five-way grade. See `tokens.ts`'s `GRADES` for why the
 * headline gets a finer scale than the three-state `Tone` everywhere else.
 */
export function scoreGrade(value: number): Grade {
  if (value >= 85) return "excellent";
  if (value >= 75) return "good";
  if (value >= 65) return "fair";
  if (value >= 55) return "weak";
  return "poor";
}

/* -------------------------------------------------------------------------- */
/* questions to ask the seller                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether spec 6.6's section renders when there is no report.
 *
 * The gate's verdicts -- salvage title, "for parts", an implausible discount --
 * are findings, and spec 10 is explicit that the tool should "return the
 * verdict without a model call". The `deployment_` reasons are not findings:
 * "the known-issues call is switched off in this deployment's configuration"
 * describes a server the buyer has no relationship with, in vocabulary from the
 * wrong side of the screen. Those hide the section entirely.
 */
export function knownIssuesReasonIsShowable(code: string | null): boolean {
  return code !== null && !code.startsWith("deployment_");
}
