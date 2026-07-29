/**
 * The overlay's sections (see `index.ts` for how they're assembled).
 *
 * Score breakdown (`breakdown.ts`) is the panel's centerpiece in this layout:
 * each of its four dimension bars is itself a dropdown, and this module
 * supplies what goes inside each one -- `buildPricing` for price residual,
 * `buildCompleteness` for information completeness, `buildVehicleRiskDetail`
 * for vehicle risk, `buildSellerScamRiskDetail` for seller and scam risk.
 * Negotiation and Better alternatives stay their own disclosures further
 * down, each with a summary line that carries the finding, so a user who
 * never expands one has still been told the listing has sat 38 days.
 */

import type { EvaluationResponse } from "../../shared/types";
import {
  aiBadge,
  callout,
  chip,
  disclosure,
  el,
  list,
  listingLink,
  money,
  rows,
  type Row,
} from "./elements";
import { confidenceTone, knownIssuesReasonIsShowable } from "./state";

/* -------------------------------------------------------------------------- */
/* pricing (spec 5.1's numbers)                                               */
/* -------------------------------------------------------------------------- */

export function buildPricing(data: EvaluationResponse): HTMLElement[] {
  const p = data.pricing;

  // Comp count used to repeat here. It is already the first thing the headline
  // says (`priceComparison` in state.ts), an inch above this section, so
  // printing it twice spent a row saying nothing new.
  const figures: Row[] = [["Current ask", money(p.ask_cents), { big: true }]];
  if (p.expected_asking_cents !== null) {
    figures.push([
      "Expected asking",
      `${money(p.asking_interval_low_cents)} – ${money(p.asking_interval_high_cents)}`,
    ]);
  }
  figures.push(["Confidence", p.confidence, { tone: confidenceTone(p.confidence) }]);
  return [rows(figures)];
}

/* -------------------------------------------------------------------------- */
/* information completeness (spec 5.2)                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the score actually rewarded and penalised -- concise by construction:
 * one line for what's missing (the thing that cost points), one for what's
 * stated, nothing else, since the fields themselves are the whole story.
 */
export function buildCompleteness(data: EvaluationResponse): HTMLElement[] {
  const { present, missing } = data.completeness;
  const nodes: HTMLElement[] = [
    el(
      "p",
      "muted",
      missing.length === 0
        ? "The seller disclosed everything this tool looks for."
        : `Not stated: ${missing.join(", ")}.`,
    ),
  ];
  if (present.length) nodes.push(el("p", "muted", `Stated: ${present.join(", ")}.`));
  return nodes;
}

/* -------------------------------------------------------------------------- */
/* risk: red flags / recalls / known issues                                   */
/* -------------------------------------------------------------------------- */

//: The five scam signals this product can actually evaluate (`flags/scam.py`'s
//: module docstring explains why only five of the spec's seven are checkable).
//: Kept as its own small map, the same way `state.ts`'s `limiterText` restates
//: backend prose for the panel rather than shipping the codes raw -- the
//: backend sends codes (`scam_signals_fired`), not sentences, once the
//: sentences are no longer bundled into one prose blob meant for a single
//: disclosure (see `buildRedFlags`).
const SCAM_SIGNAL_TEXT: Record<string, string> = {
  unexplained_deep_discount:
    "Priced far below comparable listings with no explanation in the description.",
  few_or_stock_photos: "Very few photos for a vehicle at this price.",
  minimal_description: "Description is minimal or looks templated.",
  vin_omitted_from_detailed_listing:
    "The listing is detailed in every other respect but omits the VIN.",
  payment_or_meeting_red_flags:
    "Payment or meeting terms that legitimate private sellers rarely ask for.",
};

function scamSignalText(code: string): string {
  return SCAM_SIGNAL_TEXT[code] ?? code.replace(/_/g, " ");
}

//: Below this a star rating gets called out as a red flag. UNCALIBRATED, like
//: every other threshold in this panel (spec 9) -- Marketplace ratings skew
//: high, so a rating in this range is a genuine outlier rather than typical
//: noise. A rating at or above it says nothing (most sellers clear it) and is
//: left out rather than printed as reassurance nobody asked for.
const LOW_RATING_THRESHOLD = 4.0;

/**
 * Red flags about the LISTING itself: the scam-pattern combination (spec
 * 6.3), a dealer posing as a private seller, and a star rating low enough to
 * be a signal rather than noise. Title status used to live here too; it now
 * sits with the headliner score instead (`headline.ts`'s `buildTitleStatus`),
 * since it is important enough to see before a click rather than after one.
 *
 * The bullets are deliberately built from the structured fields rather than
 * the backend's prose `messages` list: that list always includes the
 * seller's rating once there are enough reviews to trust, GOOD or bad,
 * because it also caps the score (`evaluation/score.py`). A 4.9-star line has
 * no business in a list titled "red flags", so this reconstructs only the
 * parts that are actually flags.
 */
function buildRedFlags(data: EvaluationResponse): HTMLElement[] {
  const seller = data.seller_risk;

  const flagNodes: HTMLElement[] = [];

  const bullets: string[] = [];
  if (seller?.seller_type === "dealer") {
    bullets.push(
      "Looks like a dealer listing rather than a private-party sale -- the asking price " +
        "may include reconditioning, warranty and overhead.",
    );
  }
  if (seller) bullets.push(...seller.scam_signals_fired.map(scamSignalText));
  if (seller?.seller_rating_average != null && seller.seller_rating_average < LOW_RATING_THRESHOLD) {
    const count = seller.seller_rating_count ?? 0;
    bullets.push(
      `Low seller rating: ${seller.seller_rating_average.toFixed(1)}/5 from ${count} ` +
        `review${count === 1 ? "" : "s"} on Marketplace.`,
    );
  }

  // Spec 6.3: "Flag the COMBINATION... Four together is a strong signal and
  // should produce a distinct, prominent warning rather than a numerical
  // deduction buried in a composite." `scam_warning` is the backend's own
  // threshold (`SCAM_SIGNALS_FOR_WARNING`), read rather than recounted here.
  if (seller?.scam_warning) {
    flagNodes.push(
      callout("adverse", "Several scam patterns fired together", [
        `${seller.scam_signals_fired.length} independent signals fired on this listing. ` +
          "Any one of them is weak. This many at once is not, and it is why no deal score " +
          "is shown.",
        list(bullets) ?? el("span"),
      ]),
    );
  } else {
    const ul = list(bullets);
    if (ul) flagNodes.push(ul);
  }

  if (flagNodes.length === 0) {
    flagNodes.push(el("p", "muted", "No red flags identified on this listing."));
  }
  return flagNodes;
}

/** Open recall campaigns (spec 6.2), on its own rather than mixed with
 * complaint density -- the two are different questions with different
 * caveats, and combining them was what made the old panel drop recalls
 * entirely once they read as noise on almost every VIN. */
function buildRecalls(data: EvaluationResponse): HTMLElement[] {
  const risk = data.vehicle_risk;
  if (risk.recall_count === null) {
    return [el("p", "muted", "No recall data available for this vehicle.")];
  }
  const nodes: HTMLElement[] = [
    rows([
      [
        "Open recall campaigns",
        `${risk.recall_count}`,
        { tone: risk.recall_count > 0 ? "caution" : "favorable" },
      ],
    ]),
  ];
  // recall_messages()[1] is the caveat sentence (see `nhtsa/assessment.py`),
  // kept as the single source of truth rather than restated here.
  if (risk.recall_count > 0 && risk.recall_messages[1]) {
    nodes.push(el("p", "muted", risk.recall_messages[1]));
  }
  return nodes;
}

/**
 * What's known to be wrong with THIS model at THIS mileage: the cached LLM
 * read (spec 6.6), concise by construction -- the prompt already refuses to
 * pad an empty list (`known_issues/prompt.py`), so this renders what it's
 * given rather than imposing its own cap on top.
 *
 * Deliberately LLM-only. NHTSA complaint density (count and top components)
 * used to render here too, but it read as part of the model's finding when it
 * is gathered data with its own caveats -- it stays in `vehicle_risk` for
 * scoring, just not surfaced beside the LLM prose.
 *
 * "Ask" is deliberately absent: those bullets are spec 7's own section now
 * (`buildQuestions`), not folded in here.
 */
function buildKnownIssuesSubsection(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const risk = data.vehicle_risk;
  const known = data.known_issues;

  if (known) {
    nodes.push(el("p", "known-summary", known.summary));
  } else if (
    data.known_issues_unavailable_reason &&
    knownIssuesReasonIsShowable(data.known_issues_unavailable_code)
  ) {
    nodes.push(el("p", "muted", data.known_issues_unavailable_reason));
  }

  if (risk.decoded_spec) nodes.push(rows([["VIN decode", risk.decoded_spec]]));

  if (known) {
    const groups: Array<[string, string[]]> = [
      ["Known to go wrong", known.failure_modes],
      ["Check on the viewing", known.inspect],
      ["Living with it", known.ownership_notes],
    ];
    for (const [label, items] of groups) {
      const ul = list(items);
      if (!ul) continue;
      nodes.push(el("p", "muted", label), ul);
    }
  }

  if (nodes.length === 0) {
    nodes.push(el("p", "muted", "No known-issue data available for this vehicle."));
  }
  return nodes;
}

/**
 * What goes inside the score breakdown's "vehicle risk" dropdown: open
 * recalls, plus what's known to go wrong with the CAR (NHTSA complaint
 * density and the cached LLM read, spec 6.6) -- each its own nested dropdown
 * rather than a plain heading, so a reader who only cares about recalls
 * never has to scroll past the known-issues prose to find them. Title
 * branding lives in `buildSellerScamRiskDetail` instead, alongside the rest
 * of what a buyer would call a "red flag" about the listing.
 *
 * The AI pill sits on "Known issues" specifically, not on the outer "vehicle
 * risk" bar -- recalls are deterministic NHTSA data, and the pill should mark
 * exactly the content that leans on the model, not everything near it.
 */
export function buildVehicleRiskDetail(data: EvaluationResponse): HTMLElement[] {
  return [
    disclosure("Recalls", "", buildRecalls(data)),
    disclosure("Known issues", "", buildKnownIssuesSubsection(data), aiBadge()),
  ];
}

/**
 * What goes inside the score breakdown's "seller and scam risk" dropdown:
 * red flags about the LISTING (title status, the scam-pattern combination,
 * a dealer posing as private, a low star rating) plus the questions spec
 * 6.6's cached LLM call generated for the seller conversation, each its own
 * nested dropdown. "Questions" is only added when there is something under
 * it -- an empty dropdown over nothing is worse than no dropdown at all --
 * and carries the AI pill on its own, since red flags are deterministic.
 */
export function buildSellerScamRiskDetail(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [disclosure("Red flags", "", buildRedFlags(data))];
  const questions = buildQuestions(data);
  if (questions.length) {
    nodes.push(disclosure("Questions to ask the seller", "", questions, aiBadge()));
  }
  return nodes;
}

function buildQuestions(data: EvaluationResponse): HTMLElement[] {
  const known = data.known_issues;
  if (known) {
    const ul = list(known.ask);
    return ul
      ? [ul]
      : [
          el(
            "p",
            "muted",
            "No vehicle-specific questions -- the standard checklist (title, service " +
              "history, accident history) covers this one.",
          ),
        ];
  }
  if (
    data.known_issues_unavailable_reason &&
    knownIssuesReasonIsShowable(data.known_issues_unavailable_code)
  ) {
    return [el("p", "muted", data.known_issues_unavailable_reason)];
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* negotiation (spec 6.4)                                                     */
/* -------------------------------------------------------------------------- */

function leverageTone(leverage: string) {
  if (leverage === "strong") return "favorable" as const;
  if (leverage === "moderate") return "caution" as const;
  return "neutral" as const;
}

export function negotiationSummary(data: EvaluationResponse): Node {
  const n = data.negotiation;
  const wrapper = el("span", "summary-inline");
  wrapper.append(chip(leverageTone(n.leverage), `${n.leverage} leverage`));
  const days =
    n.days_listed === null ? "no posted date" : `listed ${n.days_listed} day${n.days_listed === 1 ? "" : "s"}`;
  wrapper.append(
    el(
      "span",
      "disclosure-summary",
      n.suggested_offer_cents === null
        ? days
        : `${days} · suggest ${money(n.suggested_offer_cents)}`,
    ),
  );
  return wrapper;
}

export function buildNegotiation(data: EvaluationResponse): HTMLElement[] {
  const n = data.negotiation;
  const nodes: HTMLElement[] = [];

  const figures: Row[] = [
    ["Leverage", n.leverage, { tone: leverageTone(n.leverage) }],
    ["Days listed", n.days_listed === null ? "unknown" : `${n.days_listed}`],
  ];
  if (n.suggested_offer_cents !== null) {
    figures.push(["Suggested offer", money(n.suggested_offer_cents), { big: true }]);
  }
  nodes.push(rows(figures));

  const points = list(n.leverage_points);
  if (points) nodes.push(points);

  if (n.motivated_phrases.length || n.rigid_phrases.length) {
    const phrases: Row[] = [];
    if (n.motivated_phrases.length) {
      phrases.push(["Sounds motivated", n.motivated_phrases.join(", "), { tone: "favorable" }]);
    }
    if (n.rigid_phrases.length) {
      phrases.push(["Sounds firm", n.rigid_phrases.join(", "), { tone: "caution" }]);
    }
    nodes.push(rows(phrases));
  }

  // Spec 6.4 opens by insisting this is "genuinely orthogonal to deal quality",
  // and it is the one place in the panel where a good reading and a bad deal
  // routinely coincide. Say so where they are read together.
  nodes.push(
    el(
      "p",
      "muted",
      "Negotiating room is not deal quality: a slightly overpriced car that has sat two " +
        "months is a weak deal and a strong negotiation.",
    ),
  );
  return nodes;
}

/* -------------------------------------------------------------------------- */
/* better alternatives (spec 6.5)                                             */
/* -------------------------------------------------------------------------- */

export function alternativesSummary(data: EvaluationResponse): string {
  return data.alternatives.message;
}

export function buildAlternatives(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  for (const alt of data.alternatives.items) {
    const item = el("div", "alt");
    item.append(el("div", undefined, alt.description));
    if (alt.url) item.append(listingLink(alt.url));
    nodes.push(item);
  }

  // Shown with the reason attached, or not at all. A count of withheld
  // listings tells a buyer something exists, declines to say what, and reads as
  // concealment -- it creates suspicion and delivers nothing.
  for (const withheld of data.alternatives.withheld) {
    const item = el("div", "alt");
    item.append(el("div", undefined, withheld.description));
    const reason = el("div", "alt-reason");
    reason.append(chip("caution", "not recommended"), el("span", undefined, withheld.reason));
    item.append(reason);
    if (withheld.url) item.append(listingLink(withheld.url));
    nodes.push(item);
  }

  return nodes;
}

/* -------------------------------------------------------------------------- */

export const SECTION_STYLES = `
  .summary-inline { display: inline-flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .alt {
    padding: 9px 0; border-top: 1px solid var(--border-faint);
    font-size: 12.5px; line-height: 1.5;
  }
  .alt:first-child { border-top: 0; padding-top: 2px; }
  .alt-reason {
    display: flex; gap: 8px; align-items: baseline; margin-top: 5px;
    font-size: 12px; color: var(--text-dim);
  }
  .known-summary { margin: 0 0 6px; font-size: 13px; line-height: 1.55; color: var(--text-muted); }
`;
