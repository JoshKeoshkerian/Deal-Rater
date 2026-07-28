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

/**
 * The two limiters that fire on every evaluation this tool will ever run.
 *
 * Marketplace comps carry no posted date, and dealer filtering is unavailable
 * until the seller signal is collected. Both are real, both are already in the
 * confidence explanation, and neither says anything about a particular comp
 * set -- so a summary line that leads with one is a summary line that says
 * nothing.
 */
const STRUCTURAL_LIMITERS = new Set(["dealer_filtering_unavailable", "no_recency_weighting"]);

export function hasOnlyStructuralLimiters(pricing: EvaluationResponse["pricing"]): boolean {
  return pricing.confidence_limiters.every((limiter) => STRUCTURAL_LIMITERS.has(limiter));
}

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
 * What each dimension actually contributed, sorted by that, descending.
 *
 * The bars used to be drawn from the raw sub-score, so information
 * completeness -- 9% of the number -- drew the same length as price residual at
 * 56%. A reader comparing bar lengths was comparing nothing. Length is now
 * weight x sub-score, renormalised over the dimensions that could be assessed,
 * which is exactly how `compute_deal_score` arrives at the headline: the
 * contributions sum to the score.
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

  // Assessed dimensions first, by contribution; unassessed keep their weight
  // order underneath, since they have no contribution to sort by.
  return rows.sort((a, b) => {
    if (a.points === null && b.points === null) return b.component.weight - a.component.weight;
    if (a.points === null) return 1;
    if (b.points === null) return -1;
    return b.points - a.points;
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
/* what has to be visible without expanding anything                          */
/* -------------------------------------------------------------------------- */

export function titleTone(titleRisk: string): Tone {
  switch (titleRisk) {
    case "clean":
      return "favorable";
    case "branded":
    case "disqualifying":
      return "adverse";
    default:
      // "unstated" is not "clean". Most listings simply do not say, and the
      // difference between "the seller says it is clean" and "the seller did
      // not mention it" is exactly the kind of thing a first-time buyer does
      // not know to ask about.
      return "caution";
  }
}

/**
 * How the scam section should render, per spec 6.3.
 *
 * "Flag the COMBINATION, not individual elements... Any one of these is weak.
 * Four together is a strong signal and should produce a distinct, prominent
 * warning." So one signal renders nothing at all: a section header over a
 * single weak indicator manufactures a concern the evaluation does not have,
 * and does it to the buyer least equipped to discount it.
 *
 * The 4+ threshold belongs to the backend (`SCAM_SIGNALS_FOR_WARNING`), which
 * also withholds the composite score at that point, so `scam_warning` is read
 * rather than recounted here.
 */
export type ScamDisplay = "hidden" | "listed" | "warning";

export function scamDisplay(seller: EvaluationResponse["seller_risk"]): ScamDisplay {
  if (!seller) return "hidden";
  if (seller.scam_warning) return "warning";
  return seller.scam_signals_fired.length >= 2 ? "listed" : "hidden";
}

/**
 * Whether the seller section renders at all (spec 7.4: "only when there is
 * something to say"). A dealer listing is worth saying on its own -- it means
 * the comparison is not like for like -- independently of scam signals. A
 * seller star rating is the same kind of independent reason: the backend
 * only ever populates it once there are enough reviews to trust
 * (`SELLER_RATING_MIN_REVIEWS`), so its mere presence here already means
 * there is something worth saying.
 */
export function sellerSectionVisible(seller: EvaluationResponse["seller_risk"]): boolean {
  if (!seller) return false;
  return (
    seller.seller_type === "dealer" ||
    scamDisplay(seller) !== "hidden" ||
    seller.seller_rating_average !== null
  );
}

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
