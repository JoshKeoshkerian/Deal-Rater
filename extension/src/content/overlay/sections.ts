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
  copyButton,
  disclosure,
  el,
  fillsTo,
  list,
  listingLink,
  meterRow,
  money,
  rows,
  statTile,
  type Row,
} from "./elements";
import {
  alternativeVehicle,
  confidenceTone,
  knownIssuesReasonIsShowable,
  priceDelta,
  priceGauge,
  type PriceGauge,
} from "./state";

/* -------------------------------------------------------------------------- */
/* pricing (spec 5.1's numbers)                                               */
/* -------------------------------------------------------------------------- */

/** How close to an end the ask label switches from centred to edge-aligned. */
const GAUGE_LABEL_EDGE = 0.16;

/** A mark on the gauge, positioned by fraction and titled for hover. */
function gaugeMark(className: string, position: number, title: string): HTMLElement {
  const node = el("div", className);
  node.style.left = `${Math.max(0, Math.min(1, position)) * 100}%`;
  node.title = title;
  return node;
}

/**
 * Spec 5.1's four figures on one scale.
 *
 * WHY THIS IS DRAWN AND NOT JUST LISTED
 * -------------------------------------
 * The four numbers only mean anything against each other. Read as a list, a
 * buyer has to hold "asking 14,900", "expected 13,800-14,300", "strong offer
 * 13,200" and "walk away above 14,600" in their head simultaneously to notice
 * that the ask is over the line. The scale holds them instead, and the marker's
 * tone says which side of the band it landed on.
 *
 * Every figure is still written out -- the ask above its marker, strong offer
 * and walk-away as the caption, the band in its own legend. The graphic is a
 * second reading of numbers that are all present as text, never the only one.
 */
function buildGauge(gauge: PriceGauge, p: EvaluationResponse["pricing"]): HTMLElement {
  const node = el("div", "gauge");
  node.setAttribute("role", "img");
  node.setAttribute(
    "aria-label",
    `Asking ${money(p.ask_cents)} against an expected range of ` +
      `${money(p.asking_interval_low_cents)} to ${money(p.asking_interval_high_cents)}.`,
  );

  // Row 1: the ask, labelled above its own marker so the label never collides
  // with the two caption figures on the row below.
  const askRow = el("div", "gauge-ask-row");
  if (gauge.ask !== null) {
    const label = el("div", "gauge-ask-label");
    label.dataset["tone"] = gauge.askTone;
    label.style.left = `${gauge.ask * 100}%`;
    // Centred over the marker except near the ends, where centring pushes half
    // the figure outside the panel. An ask at the top of the scale is the
    // common case (the walk-away threshold is usually below it), so this is not
    // an edge case -- it is most listings that are over the line.
    if (gauge.ask < GAUGE_LABEL_EDGE) label.dataset["align"] = "start";
    else if (gauge.ask > 1 - GAUGE_LABEL_EDGE) label.dataset["align"] = "end";
    label.append(
      el("span", "gauge-ask-value", money(p.ask_cents)),
      el("span", "gauge-ask-caption", "asking"),
    );
    askRow.append(label);
  }

  // Row 2: the track. The band is the expected interval; the two ticks are the
  // offer and walk-away thresholds.
  const track = el("div", "gauge-track");
  const band = el("div", "gauge-band");
  band.style.left = `${gauge.band!.start * 100}%`;
  band.title = `Expected asking ${money(p.asking_interval_low_cents)} – ${money(p.asking_interval_high_cents)}`;
  // Grown from zero with every other fill, so the band sweeps out from where
  // the expected price starts rather than appearing at full width.
  fillsTo(band, gauge.band!.end - gauge.band!.start);
  track.append(band);

  if (gauge.strongOffer !== null) {
    track.append(
      gaugeMark("gauge-tick", gauge.strongOffer, `Strong offer ${money(p.strong_offer_cents)}`),
    );
  }
  if (gauge.walkAway !== null) {
    track.append(
      gaugeMark("gauge-tick", gauge.walkAway, `Walk away above ${money(p.walk_away_above_cents)}`),
    );
  }
  if (gauge.ask !== null) {
    const marker = gaugeMark("gauge-ask", gauge.ask, `Asking ${money(p.ask_cents)}`);
    marker.dataset["tone"] = gauge.askTone;
    track.append(marker);
  }
  node.append(askRow, track);

  // Row 3: the thresholds, pinned to the ends rather than to their marks. A
  // label under a tick collides with the ask marker's label the moment the two
  // figures are close, which is exactly the case worth reading carefully.
  //
  // Each side is omitted when the backend did not publish that figure. "Strong
  // offer n/a" is not a fact about the car, it is the panel narrating its own
  // gaps, and printing it twice under an interval this wide says nothing the
  // low-confidence header has not already said better.
  if (p.strong_offer_cents !== null || p.walk_away_above_cents !== null) {
    const caption = el("div", "gauge-caption");
    if (p.strong_offer_cents !== null) {
      caption.append(el("span", undefined, `Strong offer ${money(p.strong_offer_cents)}`));
    }
    if (p.walk_away_above_cents !== null) {
      caption.append(
        el("span", "gauge-caption-end", `Walk away above ${money(p.walk_away_above_cents)}`),
      );
    }
    node.append(caption);
  }

  // Row 4: the band's own key, which is also where the expected range is
  // written out.
  const legend = el("div", "gauge-legend");
  legend.append(
    el("span", "gauge-swatch"),
    el(
      "span",
      undefined,
      `Expected asking ${money(p.asking_interval_low_cents)} – ${money(p.asking_interval_high_cents)}`,
    ),
  );
  node.append(legend);

  return node;
}

export function buildPricing(data: EvaluationResponse): HTMLElement[] {
  const p = data.pricing;
  const nodes: HTMLElement[] = [];

  // Spec 5.1 names four figures and the panel used to render two of them:
  // `strong_offer_cents` and `walk_away_above_cents` were serialized by the
  // backend and displayed nowhere. They are the two a buyer acts on.
  const gauge = priceGauge(p);
  if (gauge) nodes.push(buildGauge(gauge, p));

  // Comp count used to repeat here. It is already the first thing the headline
  // says (`priceComparison` in state.ts), an inch above this section, so
  // printing it twice spent a row saying nothing new. The expected range is
  // likewise not repeated when the gauge above has already written it out.
  const figures: Row[] = [["Current ask", money(p.ask_cents), { big: true }]];
  if (!gauge && p.expected_asking_cents !== null) {
    figures.push([
      "Expected asking",
      `${money(p.asking_interval_low_cents)} – ${money(p.asking_interval_high_cents)}`,
    ]);
  }
  figures.push(["Confidence", p.confidence, { tone: confidenceTone(p.confidence) }]);
  nodes.push(rows(figures));
  return nodes;
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

//: Facebook's "About this vehicle" owner-count fact (`vehicle_number_of_owners`).
//: Only the multi-owner cases are worth a flag -- "one owner" is reassurance
//: nobody asked for, same reasoning as the rating threshold above.
const OWNER_COUNT_FLAG_TEXT: Record<string, string> = {
  two: "Seller states this vehicle has had two owners.",
  three_plus: "Seller states this vehicle has had three or more owners.",
};

/**
 * Red flags about the LISTING itself: the scam-pattern combination (spec
 * 6.3), a dealer posing as a private seller, more than one previous owner,
 * and a star rating low enough to be a signal rather than noise. Title
 * status used to live here too; it now sits with the headliner score instead
 * (`headline.ts`'s `buildTitleStatus`), since it is important enough to see
 * before a click rather than after one.
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
  const ownerCount = data.vehicle_details.owner_count;
  if (ownerCount && OWNER_COUNT_FLAG_TEXT[ownerCount]) {
    bullets.push(OWNER_COUNT_FLAG_TEXT[ownerCount]);
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
  // A tile rather than a row: spec 6.2 wants open recalls "surfaced prominently
  // regardless of score weight", and as one line item among several this read
  // like a field rather than a finding.
  const nodes: HTMLElement[] = [
    statTile(
      risk.recall_count === 1 ? "Open recall campaign" : "Open recall campaigns",
      `${risk.recall_count}`,
      risk.recall_count > 0 ? "caution" : "favorable",
    ),
  ];
  // recall_messages()[1] is the caveat sentence (see `nhtsa/assessment.py`),
  // kept as the single source of truth rather than restated here.
  if (risk.recall_count > 0 && risk.recall_messages[1]) {
    nodes.push(el("p", "muted", risk.recall_messages[1]));
  }
  return nodes;
}

/**
 * NHTSA complaint density (spec 6.2), which the backend has always sent and
 * the panel has never rendered.
 *
 * Its own subsection rather than an addition to "Known issues", which is where
 * it used to live and why it was dropped: sitting under the model's prose it
 * read as part of the model's finding, when it is gathered data with entirely
 * different caveats. Beside Recalls it reads as what it is -- the second piece
 * of deterministic NHTSA evidence about this vehicle.
 *
 * The count carries NO tone. Complaint volume is only meaningful against
 * segment norms, the response does not carry them, and colouring a bare count
 * would be the panel inventing a judgement -- exactly what `state.ts`'s
 * docstring forbids. The backend's own `complaint_messages` do the
 * interpreting.
 */
function buildComplaints(data: EvaluationResponse): HTMLElement[] {
  const risk = data.vehicle_risk;
  if (risk.complaint_count === null) {
    return [el("p", "muted", "No complaint data available for this vehicle.")];
  }

  const nodes: HTMLElement[] = [
    statTile("Owner complaints filed", risk.complaint_count.toLocaleString("en-US")),
  ];

  const components = risk.top_complaint_components;
  if (components.length) {
    const worst = Math.max(...components.map(([, count]) => count), 1);
    nodes.push(el("p", "muted", "Most complained-about systems"));
    const chart = el("div", "complaint-chart");
    for (const [component, count] of components) {
      chart.append(
        meterRow(component.toLowerCase(), count.toLocaleString("en-US"), count / worst),
      );
    }
    nodes.push(chart);
  }

  for (const message of risk.complaint_messages) {
    nodes.push(el("p", "muted", message));
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
 * is gathered data with its own caveats. It now has its own "Complaints"
 * subsection alongside Recalls -- surfaced, just not beside the LLM prose.
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
    disclosure("Complaints", "", buildComplaints(data)),
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
    // These exist to be sent to a stranger, and a buyer who cannot copy them
    // retypes them into Messenger one at a time or, more likely, asks none of
    // them. Newline-joined rather than bulleted: the destination is a chat box.
    if (ul) {
      const actions = el("div", "questions-actions");
      actions.append(copyButton(known.ask.join("\n"), "Copy all"));
      return [actions, ul];
    }
    return [
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

  // `strength` is the 0-100 behind the one-word leverage label, and it was
  // serialized and never shown. The word alone cannot distinguish a listing
  // that just crossed into "moderate" from one at the top of the band, which
  // is the difference between opening low and opening very low.
  nodes.push(
    meterRow(
      "Negotiating room",
      `${Math.round(n.strength)}/100`,
      n.strength / 100,
      leverageTone(n.leverage),
    ),
  );

  const figures: Row[] = [
    ["Leverage", n.leverage, { tone: leverageTone(n.leverage) }],
    ["Days listed", n.days_listed === null ? "unknown" : `${n.days_listed}`],
  ];
  nodes.push(rows(figures));

  // The offer is lifted out of the figure rows and given its own block. It is
  // the one number in the panel meant to be said out loud to another person,
  // and it is the other thing (with the seller questions) worth copying rather
  // than transcribing.
  if (n.suggested_offer_cents !== null) {
    const offer = el("div", "offer");
    const text = el("div", "offer-text");
    text.append(
      el("div", "offer-label", "Suggested offer"),
      el("div", "offer-figure", money(n.suggested_offer_cents)),
    );
    offer.append(text, copyButton(money(n.suggested_offer_cents)));
    nodes.push(offer);
  }

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

  return nodes;
}

/* -------------------------------------------------------------------------- */
/* better alternatives (spec 6.5)                                             */
/* -------------------------------------------------------------------------- */

export function alternativesSummary(data: EvaluationResponse): string {
  return data.alternatives.message;
}

/**
 * One nearby listing, as a card.
 *
 * The backend sends `description` as a pre-formatted line with the price,
 * mileage, location and advantage already baked into it, AND sends each of
 * those as its own field. This renders the fields -- so the price is a figure
 * that can be sized, the difference against this listing is a tone chip, and
 * the mileage tradeoff is a flag rather than a clause in a sentence. Only the
 * vehicle name is taken from the description, because it is the one part with
 * no field of its own (see `alternativeVehicle`).
 */
interface AlternativeCard {
  description: string;
  url: string | null;
  price_cents: number | null;
  mileage: number | null;
  location_text: string | null;
  /** Recommended alternatives carry this; withheld ones have no such field. */
  mileage_tradeoff?: boolean;
}

function buildAlternativeCard(item: AlternativeCard, askCents: number | null): HTMLElement {
  const node = el("div", "alt");

  const head = el("div", "alt-head");
  head.append(el("span", "alt-vehicle", alternativeVehicle(item.description)));
  node.append(head);

  const priceRow = el("div", "alt-price-row");
  priceRow.append(el("span", "alt-price", money(item.price_cents)));
  const delta = priceDelta(item.price_cents, askCents);
  if (delta) priceRow.append(chip(delta.tone, delta.text));
  node.append(priceRow);

  const facts: string[] = [];
  if (item.mileage !== null) facts.push(`${item.mileage.toLocaleString("en-US")} mi`);
  if (item.location_text) facts.push(item.location_text);
  if (facts.length) node.append(el("div", "alt-meta", facts.join(" · ")));

  // A cheaper car with far more miles on it is not straightforwardly better,
  // and the backend already worked that out. Saying so is the difference
  // between a list of prices and a recommendation.
  if (item.mileage_tradeoff) {
    const flag = el("div", "alt-reason");
    flag.append(chip("caution", "higher mileage"), el("span", undefined, "for the lower price."));
    node.append(flag);
  }

  if (item.url) node.append(listingLink(item.url));
  return node;
}

export function buildAlternatives(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const ask = data.pricing.ask_cents;

  for (const alt of data.alternatives.items) {
    nodes.push(buildAlternativeCard(alt, ask));
  }

  // Shown with the reason attached, or not at all. A count of withheld
  // listings tells a buyer something exists, declines to say what, and reads as
  // concealment -- it creates suspicion and delivers nothing.
  for (const withheld of data.alternatives.withheld) {
    const item = buildAlternativeCard(withheld, ask);
    item.dataset["withheld"] = "true";
    const reason = el("div", "alt-reason");
    reason.append(chip("caution", "not recommended"), el("span", undefined, withheld.reason));
    // Before the link, after the facts: the reason has to be read on the way to
    // clicking through, not underneath the thing it is warning about.
    const link = item.querySelector("a");
    if (link) item.insertBefore(reason, link);
    else item.append(reason);
    nodes.push(item);
  }

  return nodes;
}

/* -------------------------------------------------------------------------- */

export const SECTION_STYLES = `
  .summary-inline {
    display: inline-flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
  }

  /* price gauge ------------------------------------------------------- */
  /* Four rows -- the ask label, the track, the two thresholds, the band's
     legend -- that used to sit almost flush against each other (an 8px and
     two 6px gaps for a section carrying five separate readings). Each gap
     below is now its own step up the scale rather than the smallest one
     repeated four times. */
  .gauge { margin: 0 0 var(--sp-6); }
  .gauge-ask-row { position: relative; height: 40px; }
  .gauge-ask-label {
    position: absolute; bottom: var(--sp-2); transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    white-space: nowrap; line-height: 1.15;
  }
  /* Centring a label over a marker near either end pushes half the figure out
     of the panel. At the ends it hangs inward instead. */
  .gauge-ask-label[data-align="start"] { transform: translateX(0); align-items: flex-start; }
  .gauge-ask-label[data-align="end"] { transform: translateX(-100%); align-items: flex-end; }
  .gauge-ask-value {
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-md); font-weight: 700; letter-spacing: -.01em;
  }
  .gauge-ask-caption {
    font-size: var(--fs-2xs); letter-spacing: .07em; text-transform: uppercase;
    color: var(--text-faint);
  }
  .gauge-ask-label[data-tone="favorable"] .gauge-ask-value { color: var(--tone-favorable-text); }
  .gauge-ask-label[data-tone="caution"] .gauge-ask-value   { color: var(--tone-caution-text); }
  .gauge-ask-label[data-tone="adverse"] .gauge-ask-value   { color: var(--tone-adverse-text); }
  .gauge-ask-label[data-tone="neutral"] .gauge-ask-value   { color: var(--text); }

  .gauge-track {
    position: relative; height: 11px; border-radius: var(--radius-pill);
    background: var(--track);
  }
  .gauge-band {
    position: absolute; top: 0; bottom: 0; width: 0;
    border-radius: var(--radius-pill);
    background: var(--tone-neutral-fill);
    transition: width var(--dur-slow) var(--ease-out);
  }
  /* Thresholds as hairlines through the track, recessive against the band and
     the ask marker -- they are reference lines, not data. */
  .gauge-tick {
    position: absolute; top: -3px; bottom: -3px; width: 2px;
    transform: translateX(-1px); border-radius: 1px;
    background: var(--text-faint); opacity: .75;
  }
  /* The ask overlaps the band, so it carries a ring in the panel's own surface
     colour: without it the marker and the fill merge into one shape at exactly
     the moment the reader is trying to see which side of the band it is on. */
  .gauge-ask {
    position: absolute; top: 50%; width: 14px; height: 14px;
    margin: -7px 0 0 -7px; border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 2.5px var(--sheet), var(--elev-1);
  }
  .gauge-ask[data-tone="favorable"] { background: var(--tone-favorable-fill); }
  .gauge-ask[data-tone="caution"]   { background: var(--tone-caution-fill); }
  .gauge-ask[data-tone="adverse"]   { background: var(--tone-adverse-fill); }

  .gauge-caption {
    display: flex; justify-content: space-between; gap: var(--sp-4);
    margin-top: var(--sp-4);
    /* With only the walk-away figure present it still belongs on the right,
       where its tick is, rather than sliding left into the strong-offer slot. */
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-xs); color: var(--text-faint);
  }
  .gauge-caption-end { margin-left: auto; }
  .gauge-legend {
    display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-4);
    font-size: var(--fs-xs); color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .gauge-swatch {
    width: 14px; height: 6px; border-radius: var(--radius-pill); flex: none;
    background: var(--tone-neutral-fill);
  }

  /* complaints -------------------------------------------------------- */
  .complaint-chart { margin-top: var(--sp-3); }
  .complaint-chart .meter-label { text-transform: capitalize; }

  /* negotiation ------------------------------------------------------- */
  .offer {
    display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4);
    margin-top: var(--sp-4); padding: var(--sp-4);
    border: 1px solid var(--border); border-radius: var(--radius-md);
    background: var(--raised);
  }
  .offer-label {
    font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .07em;
    text-transform: uppercase; color: var(--text-dim);
  }
  .offer-figure {
    margin-top: 2px;
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-lg); font-weight: 700; letter-spacing: -.02em; color: var(--text);
  }

  .questions-actions { display: flex; justify-content: flex-end; margin-bottom: var(--sp-1); }

  /* alternatives ------------------------------------------------------ */
  .alt {
    padding: var(--sp-4) 0; border-top: 1px solid var(--border-faint);
    font-size: var(--fs-sm); line-height: 1.5;
  }
  .alt:first-child { border-top: 0; padding-top: var(--sp-1); }
  .alt[data-withheld="true"] { opacity: .82; }
  .alt-head { display: flex; align-items: baseline; gap: var(--sp-3); }
  .alt-vehicle { font-weight: 650; color: var(--text); font-size: var(--fs-base); }
  .alt-price-row {
    display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
    margin-top: var(--sp-2);
  }
  .alt-price {
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-md); font-weight: 650; color: var(--text);
  }
  .alt-meta {
    margin-top: 3px; color: var(--text-dim); font-variant-numeric: tabular-nums;
  }
  .alt-reason {
    display: flex; gap: var(--sp-3); align-items: baseline; margin-top: var(--sp-2);
    font-size: var(--fs-sm); color: var(--text-dim);
  }
  .alt a { margin-top: var(--sp-2); }

  .known-summary {
    margin: 0 0 var(--sp-2); font-size: var(--fs-base); line-height: 1.55; color: var(--text-muted);
  }
`;
