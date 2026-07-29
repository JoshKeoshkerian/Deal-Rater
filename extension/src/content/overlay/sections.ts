/**
 * The overlay's sections, in the panel's vertical order (see `index.ts`).
 *
 * Each one exports a builder and, where it needs one, the summary line shown
 * while it is collapsed. The summary always carries the finding rather than
 * naming the section: a user who never expands "Negotiation" should still have
 * been told the listing has sat 38 days.
 */

import type { EvaluationResponse } from "../../shared/types";
import {
  callout,
  chip,
  el,
  list,
  listingLink,
  money,
  rows,
  type Row,
} from "./elements";
import { confidenceTone, knownIssuesReasonIsShowable } from "./state";

/* -------------------------------------------------------------------------- */
/* pricing / details (spec 5.1's four numbers, plus the target's own facts)   */
/* -------------------------------------------------------------------------- */

export function buildPricing(data: EvaluationResponse): HTMLElement[] {
  const p = data.pricing;
  const v = data.vehicle_details;

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

  // The listing's own stated facts, not a judgement -- title STATUS here is
  // the seller's word ("Clean", "Rebuilt"); the graded reading of it lives in
  // the Risk section's red flags instead.
  const details: Row[] = [];
  if (v.year !== null) details.push(["Year", `${v.year}`]);
  if (v.make) details.push(["Make", v.make]);
  if (v.model) details.push(["Model", v.model]);
  details.push([
    "Mileage",
    v.mileage !== null ? `${v.mileage.toLocaleString("en-US")} mi` : "not stated",
  ]);
  details.push(["Title status", v.title_status ?? "not stated"]);

  const grid = el("div", "pricing-grid");
  grid.append(rows(figures), rows(details));
  return [grid];
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
 * Red flags about the LISTING itself: title branding, the scam-pattern
 * combination (spec 6.3), a dealer posing as a private seller, and a
 * star rating low enough to be a signal rather than noise.
 *
 * Deliberately built from the structured fields rather than the backend's
 * prose `messages` list: that list always includes the seller's rating once
 * there are enough reviews to trust, GOOD or bad, because it also caps the
 * score (`evaluation/score.py`). A 4.9-star line has no business in a list
 * titled "red flags", so this reconstructs only the parts that are actually
 * flags.
 */
function buildRedFlags(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const risk = data.vehicle_risk;
  const seller = data.seller_risk;

  if (risk.title_risk === "disqualifying" || risk.title_risk === "branded") {
    nodes.push(callout("adverse", `Title: ${risk.title_risk}`, [risk.title_message]));
  } else if (risk.title_risk === "unstated") {
    nodes.push(callout("caution", "Title status not stated", [risk.title_message]));
  }

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
    nodes.push(
      callout("adverse", "Several scam patterns fired together", [
        `${seller.scam_signals_fired.length} independent signals fired on this listing. ` +
          "Any one of them is weak. This many at once is not, and it is why no deal score " +
          "is shown.",
        list(bullets) ?? el("span"),
      ]),
    );
  } else {
    const ul = list(bullets);
    if (ul) nodes.push(ul);
  }

  if (nodes.length === 0) {
    nodes.push(el("p", "muted", "No red flags identified on this listing."));
  }
  return nodes;
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
 * What's known to be wrong with THIS model at THIS mileage: NHTSA complaint
 * density (gathered, not generated) plus the cached LLM read (spec 6.6),
 * concise by construction -- the prompt already refuses to pad an empty list
 * (`known_issues/prompt.py`), so this renders what it's given rather than
 * imposing its own cap on top.
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

  const figures: Row[] = [];
  if (risk.complaint_count !== null) figures.push(["Owner complaints", `${risk.complaint_count}`]);
  if (risk.decoded_spec) figures.push(["VIN decode", risk.decoded_spec]);
  if (figures.length) nodes.push(rows(figures));

  if (risk.top_complaint_components.length) {
    nodes.push(el("p", "muted", "Most complained-about systems"));
    nodes.push(
      list(risk.top_complaint_components.map(([name, count]) => `${name.toLowerCase()} (${count})`))!,
    );
  }

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

function subheading(text: string): HTMLElement {
  return el("h3", "risk-subhead", text);
}

/**
 * The combined Risk section: red flags about the LISTING, open recalls, and
 * what's known to go wrong with the CAR. Three previously separate panels
 * (vehicle risk, seller and scam risk, "what to check on this car") folded
 * into one, because a buyer weighing risk does not think in the product's
 * internal dimension boundaries -- they think "what's wrong with this deal".
 */
export function buildRisk(data: EvaluationResponse): HTMLElement[] {
  return [
    subheading("Red flags"),
    ...buildRedFlags(data),
    subheading("Recalls"),
    ...buildRecalls(data),
    subheading("Known issues"),
    ...buildKnownIssuesSubsection(data),
  ];
}

/* -------------------------------------------------------------------------- */
/* questions to ask the seller (spec 6.6's "ask", promoted to its own section) */
/* -------------------------------------------------------------------------- */

/**
 * Empty ([]) only when there is nothing to show at all -- `index.ts` relies on
 * that to hide the section via `section()`'s own empty-body guard, the same
 * way every other always-visible section does.
 */
export function buildQuestions(data: EvaluationResponse): HTMLElement[] {
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
  .pricing-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 20px; align-items: start; }
  .risk-subhead {
    margin: 18px 0 8px; font-size: 11px; font-weight: 700;
    letter-spacing: .06em; text-transform: uppercase; color: var(--text-dim);
  }
  .risk-subhead:first-child { margin-top: 0; }
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
