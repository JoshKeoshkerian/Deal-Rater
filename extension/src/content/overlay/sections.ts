/**
 * The overlay's sections (see `index.ts` for how they're assembled).
 *
 * Score breakdown (`breakdown.ts`) is the panel's centerpiece in this layout:
 * each of its four dimension bars is itself a dropdown, and this module
 * supplies what goes inside each one -- `buildPricing` for price residual,
 * `buildCompleteness` for information completeness, `buildVehicleRiskDetail`
 * for vehicle risk, `buildSellerScamRiskDetail` for seller and scam risk.
 * Negotiation and Alternatives stay their own disclosures further
 * down, each with a summary line that carries the finding, so a user who
 * never expands one has still been told the listing has sat 38 days.
 *
 * THE NEGOTIATION SECTION WAS REWORKED, AND WHY
 * ---------------------------------------------
 * It used to render a 0-100 "Negotiating room" meter, a leverage word, a day
 * count, and -- on roughly 1 listing in 20 -- a single figure labelled
 * "Suggested offer". Three things were wrong with that:
 *
 *   1. The figure was gated on the pricing dimension publishing its expected-price
 *      anchors, which `MAX_INTERVAL_WIDTH_FOR_ANCHORS` withholds on ~95% of real
 *      evaluations. So the section's one actionable output was usually absent.
 *   2. One number cannot say whether it is the opening move or the target, and a
 *      buyer who opens at their own target settles above it.
 *   3. `strength` is an uncalibrated composite that starts at 30 and tops out near
 *      83. Drawn as a meter it was the most authoritative-looking and least
 *      meaningful thing in the panel.
 *
 * What replaced them: an offer LADDER (open at / expect to pay / walk away above,
 * `state.ts`'s `offerLadder`), always populated when the listing has a price
 * because the backend now falls back to an ask-anchored plan and labels it as
 * such; days listed drawn on an AXIS with the 14/30/75-day thresholds marked, so
 * the fact interprets itself instead of being scored; and a drafted opening
 * message, which is the thing a first-time buyer actually lacks.
 */

import type { EvaluationResponse } from "../../shared/types";
import {
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
  notePill,
  rows,
  statTile,
  type Row,
} from "./elements";
import {
  alternativeVehicle,
  confidenceTone,
  leverageTone,
  offerLadder,
  offerStanceChip,
  priceDelta,
  priceGauge,
  timeOnMarketTrack,
  type OfferStep,
  type PriceGauge,
  type TimeOnMarketTrack,
} from "./state";
import type { Tone } from "./tokens";

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

//: Below this a star rating reads as adverse. UNCALIBRATED, like every other
//: threshold in this panel (spec 9) -- Marketplace ratings skew high, so a
//: rating in this range is a genuine outlier rather than typical noise.
const LOW_RATING_THRESHOLD = 4.0;

//: Matches `SELLER_RATING_MIN_REVIEWS` in `evaluation/score.py`. Below this the
//: backend does not let the rating cap the score, so the panel does not show it
//: either: a 5.0 from one review is not evidence, and printing it beside a
//: score it did not move would imply it was weighed.
const RATING_MIN_REVIEWS = 3;

//: Facebook's "About this vehicle" owner-count fact (`vehicle_number_of_owners`).
//: Only the multi-owner cases are worth a flag -- "one owner" is reassurance
//: nobody asked for, same reasoning as the rating threshold above.
const OWNER_COUNT_FLAG_TEXT: Record<string, string> = {
  two: "Seller states this vehicle has had two owners.",
  three_plus: "Seller states this vehicle has had three or more owners.",
};

/**
 * Why a low pattern count is weaker evidence than it looks, in one place so the
 * clean branch and the counted branch cannot word it differently.
 *
 * Takes the figures when the response carries them and states the same point
 * without numbers when it does not (`seller_risk: null`, the clean case).
 */
function SCAM_COVERAGE_NOTE(unchecked?: number, total?: number): HTMLElement {
  const source =
    "Price-drop history needs months of observations; seller account age is deliberately " +
    "never collected.";
  return notePill(
    unchecked !== undefined && total !== undefined
      ? `${unchecked} of the ${total} patterns this tool looks for could not be checked on ` +
          "this listing, so a low count is weaker evidence than it looks."
      : "Two of the patterns this tool looks for can never be checked yet, so a clean result " +
          "here is weaker evidence than it looks.",
    source,
  );
}

/**
 * The scam-pattern combination (spec 6.3), led by the count rather than the
 * bullets.
 *
 * WHY THE COUNT LEADS. Spec 6.3's rule is that "any one of these is weak. Four
 * together is a strong signal" -- so how MANY co-fired is the finding, and each
 * bullet is its supporting detail. Read as a flat list, individual patterns
 * invite exactly the reading the spec warns against: treating one fired signal
 * as a verdict.
 *
 * WHY THE DENOMINATOR IS ALWAYS PRINTED. `scam_signals_evaluable` is normally 5
 * against a `scam_signals_total` of 7, because two of the spec's patterns are
 * permanently dark -- price-revised-upward needs price history this product has
 * not accumulated yet (spec 12), and account age is data spec 8.2 forbids
 * collecting at all. "0 fired" therefore means "none of the five we can check",
 * not a clean bill of health, and a bare "0" claims the second. `2 of 5` is the
 * same fact without the overclaim.
 *
 * Title status used to live in this list and now sits with the headliner score
 * (`headline.ts`'s `buildTitleStatus`), being important enough to see before a
 * click rather than after one.
 */
function buildScamPatterns(data: EvaluationResponse): HTMLElement[] {
  const seller = data.seller_risk;

  // A NULL `seller_risk` IS THE CLEAN CASE, not missing data. Spec 7.4 has the
  // backend omit this section "only when there is something to say", and
  // `has_seller_section` (`evaluation/report.py`) resolves that to: nothing
  // fired, not a dealer, no rating with enough reviews to matter. That is the
  // commonest listing there is, so saying "no assessment available" here would
  // report the ordinary good outcome as a failure. The count is stated without
  // a denominator because the response carries none in this branch, and
  // inventing one would mean hard-coding a backend constant.
  if (!seller) {
    return [
      statTile("Patterns fired", "None", "favorable"),
      el(
        "p",
        "muted",
        "None of the scam patterns this tool can check fired on this listing, and the seller " +
          "has no rating low enough to note.",
      ),
      SCAM_COVERAGE_NOTE(),
    ];
  }

  const fired = seller.scam_signals_fired;
  const evaluable = seller.scam_signals_evaluable;
  const nodes: HTMLElement[] = [];

  // Spec 6.3: "Flag the COMBINATION... Four together is a strong signal and
  // should produce a distinct, prominent warning rather than a numerical
  // deduction buried in a composite." `scam_warning` is the backend's own
  // threshold (`SCAM_SIGNALS_FOR_WARNING`), read rather than recounted here.
  if (seller.scam_warning) {
    nodes.push(
      callout("adverse", "Several scam patterns fired together", [
        `${fired.length} independent patterns fired on this listing. Any one of them is ` +
          "weak. This many at once is not, and it is why no deal score is shown.",
        list(fired.map(scamSignalText)) ?? el("span"),
      ]),
    );
  } else {
    nodes.push(
      statTile(
        "Patterns fired",
        `${fired.length} of ${evaluable}`,
        fired.length === 0 ? "favorable" : "caution",
      ),
    );
    const ul = list(fired.map(scamSignalText));
    if (ul) nodes.push(ul);
    else {
      nodes.push(el("p", "muted", "None of the patterns this tool can check fired here."));
    }
  }

  // The caveat is a property of the DATA, not a finding about this listing --
  // hence `notePill` rather than another bullet. Shown whenever anything is
  // unchecked, which given the two permanently-dark patterns is essentially
  // always; `scam_reduced_sensitivity` is the backend's own name for it.
  const unchecked = seller.scam_signals_total - evaluable;
  if (unchecked > 0) nodes.push(SCAM_COVERAGE_NOTE(unchecked, seller.scam_signals_total));
  return nodes;
}

/**
 * The SELLER, as distinct from the listing: their Marketplace rating and what
 * they state about prior ownership.
 *
 * The rating is shown at every value, not only bad ones. It is a direct cap on
 * this dimension's score (`_seller_rating_ceiling` in `evaluation/score.py`),
 * so a 4.9 is load-bearing in exactly the way a 2.4 is -- it was simply
 * invisible before, which made a well-rated seller look identical to an unrated
 * one and hid why a score had not been capped. Tone carries the judgement so
 * the figure itself does not have to be editorialised.
 *
 * Dealer-vs-private is NOT here. It is still computed and still gates comp-set
 * exclusion in the backend (`pricing/comps.py`), but `vehicle_seller_type` is
 * not accurate enough to show a buyer -- see `headline.ts`'s
 * `buildSellerTypeBadge` for the full history of that decision.
 */
function buildSellerRecord(data: EvaluationResponse): HTMLElement[] {
  const seller = data.seller_risk;
  const nodes: HTMLElement[] = [];

  const average = seller?.seller_rating_average;
  const count = seller?.seller_rating_count ?? 0;
  if (average != null && count >= RATING_MIN_REVIEWS) {
    nodes.push(
      statTile(
        `Seller rating · ${count} review${count === 1 ? "" : "s"}`,
        `${average.toFixed(1)}/5`,
        average < LOW_RATING_THRESHOLD ? "adverse" : "favorable",
        average < LOW_RATING_THRESHOLD
          ? "Low enough to cap this dimension's score regardless of how the listing reads."
          : undefined,
      ),
    );
  } else {
    nodes.push(
      el(
        "p",
        "muted",
        count > 0
          ? `Only ${count} Marketplace review${count === 1 ? "" : "s"} — too few to read ` +
              "anything into."
          : "This seller has no Marketplace rating yet.",
      ),
    );
  }

  const ownerCount = data.vehicle_details.owner_count;
  if (ownerCount && OWNER_COUNT_FLAG_TEXT[ownerCount]) {
    nodes.push(el("p", "muted", OWNER_COUNT_FLAG_TEXT[ownerCount]));
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

  // complaint_messages()[0] is the count/breakdown sentence, [1] the caveat
  // that the count isn't adjusted for sales volume (see `nhtsa/assessment.py`).
  // The caveat gets the pill treatment -- it's a property of the DATA, not a
  // finding about this vehicle, and reading like one buried it in the past.
  if (risk.complaint_messages[0]) {
    nodes.push(el("p", "muted", risk.complaint_messages[0]));
  }
  if (risk.complaint_messages[1]) {
    nodes.push(
      notePill(
        risk.complaint_messages[1],
        "Source: NHTSA complaints database, by year/make/model.",
      ),
    );
  }
  return nodes;
}

/**
 * What goes inside the score breakdown's "vehicle risk" dropdown: open
 * recalls, NHTSA complaint density, and -- only when a VIN was recovered --
 * the decoded specification. The qualitative model read (spec 6.6, "Known
 * issues" and "Questions to ask the seller") no longer lives here: both used
 * to be one call rendered across two unrelated dropdowns, and now render
 * together as their own top-level "AI Insights" section (`ai-insights.ts`),
 * directly below the score breakdown rather than buried inside it.
 */
export function buildVehicleRiskDetail(data: EvaluationResponse): HTMLElement[] {
  const nodes = [
    disclosure("Recalls", "", buildRecalls(data)),
    disclosure("Complaints", "", buildComplaints(data)),
  ];
  const decoded = data.vehicle_risk.decoded_spec;
  if (decoded) {
    nodes.push(disclosure("Vehicle specification", "", [rows([["VIN decode", decoded]])]));
  }
  return nodes;
}

/**
 * What goes inside the score breakdown's "seller and scam risk" dropdown, as
 * the two questions the dimension's name actually contains: is this listing
 * behaving like a scam, and who is selling it.
 *
 * ONE FLAT "RED FLAGS" LIST BEFORE THIS, and it had two problems. It mixed the
 * scam-pattern combination with facts that are not patterns at all (owner
 * count, star rating), so spec 6.3's "any one is weak, four together is strong"
 * reading was unavailable -- everything was one undifferentiated bullet list.
 * And `minimal_description` restated, almost verbatim, what information
 * completeness had already reported one bar above: both fire off a 120-char
 * description (`SCAM_MINIMAL_DESCRIPTION_CHARS` and `MINIMAL_DESCRIPTION_CHARS`
 * in `flags/params.py` are the same number), so a thin listing was flagged
 * twice in one panel as though two things were wrong with it.
 *
 * That signal is still LISTED here, because dropping the bullet while the
 * backend still counts it toward the warning threshold would print a count that
 * does not match its own evidence. What changed is that the count leads and the
 * bullets support it, so this section reads as "how many patterns co-fired"
 * rather than as a second, competing list of what the listing failed to say.
 *
 * The seller-conversation questions spec 6.6's cached call used to add here now
 * live in "AI Insights" (`ai-insights.ts`) alongside the rest of that call.
 */
export function buildSellerScamRiskDetail(data: EvaluationResponse): HTMLElement[] {
  const seller = data.seller_risk;

  return [
    disclosure(
      "Scam patterns",
      // The summary carries the finding, per `disclosure`'s own contract -- a
      // reader who never expands the row has still been told the count.
      seller
        ? `${seller.scam_signals_fired.length} of ${seller.scam_signals_evaluable} fired`
        : "none fired",
      buildScamPatterns(data),
    ),
    disclosure("Seller", "", buildSellerRecord(data)),
  ];
}

/* -------------------------------------------------------------------------- */
/* negotiation (spec 6.4)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The summary a reader gets without expanding: what the position is, and the one
 * figure they act on.
 *
 * It used to read "listed 38 days · suggest $12,850" -- and on roughly 19
 * listings in 20 the figure was absent entirely, so the whole line was a day
 * count. The offer now always has an opening figure when the listing has a price
 * at all, which is what makes this line worth reading.
 */
export function negotiationSummary(data: EvaluationResponse): Node {
  const n = data.negotiation;
  const wrapper = el("span", "summary-inline");
  wrapper.append(chip(leverageTone(n.leverage), `${n.leverage} leverage`));

  const parts: string[] = [];
  if (n.days_listed !== null) {
    parts.push(`listed ${n.days_listed} day${n.days_listed === 1 ? "" : "s"}`);
  }
  if (n.offer.opening_cents !== null) {
    parts.push(`open at ${money(n.offer.opening_cents)}`);
  }
  wrapper.append(
    el("span", "disclosure-summary", parts.join(" · ") || "no posted date and no asking price"),
  );
  return wrapper;
}

/**
 * Spec 7.5's three figures, on a rail.
 *
 * The rail is doing one job: making the ORDER visible. Read as three tiles the
 * figures are three prices; read as a progression they are a plan -- this is
 * where you start, this is where you land, this is where you stop. The opening
 * figure leads because it is the only one the buyer says to another person.
 */
function buildOfferLadder(steps: OfferStep[], askCents: number | null): HTMLElement {
  const node = el("div", "ladder");
  node.dataset["steps"] = `${steps.length}`;

  const rail = el("div", "ladder-rail");
  for (const step of steps) {
    const dot = el("i", "ladder-dot");
    dot.dataset["tone"] = step.tone;
    rail.append(dot);
  }

  const cells = el("div", "ladder-cells");
  for (const step of steps) {
    const cell = el("div", "ladder-cell");
    if (step.lead) cell.dataset["lead"] = "true";
    cell.dataset["tone"] = step.tone;
    cell.append(
      el("div", "ladder-label", step.label),
      el("div", "ladder-figure", money(step.cents)),
    );
    cells.append(cell);
  }

  node.append(cells, rail);

  // Every figure above is a position RELATIVE TO THE ASK, and the ask itself
  // lives in the pricing section -- inside a collapsed breakdown bar, two clicks
  // away. Without it here, "open at $13,100" is a number with nothing to be
  // measured against, which is how the old section read even when it had one.
  if (askCents !== null) {
    node.append(el("div", "ladder-caption", `against the ${money(askCents)} asking price`));
  }
  return node;
}

/**
 * Days listed as a position on an axis rather than a number in a row.
 *
 * `Listed 38 days` as a table row is a fact a reader has to interpret against
 * thresholds they do not know. With 14, 30 and 75 marked, the dot interprets
 * itself.
 */
function buildTimeTrack(track: TimeOnMarketTrack, tone: Tone): HTMLElement {
  const node = el("div", "timeline");
  node.setAttribute("role", "img");
  node.setAttribute(
    "aria-label",
    `Listed ${track.days} day${track.days === 1 ? "" : "s"} -- ${track.phase}.`,
  );

  const head = el("div", "timeline-head");
  head.append(
    el("span", "timeline-value", `${track.days} day${track.days === 1 ? "" : "s"} listed`),
    el("span", "timeline-phase", track.phase),
  );

  const rail = el("div", "timeline-rail");
  const fill = el("i", "timeline-fill");
  fill.dataset["tone"] = tone;
  rail.append(fillsTo(fill, track.position));

  for (const mark of track.marks) {
    const tick = el("i", "timeline-tick");
    tick.style.left = `${mark.position * 100}%`;
    tick.title = `${mark.label} listed`;
    rail.append(tick);
  }

  const dot = el("i", "timeline-dot");
  dot.dataset["tone"] = tone;
  dot.style.left = `${track.position * 100}%`;
  rail.append(dot);

  const scale = el("div", "timeline-scale");
  for (const mark of track.marks) {
    const label = el("span", "timeline-scale-label", mark.label);
    label.style.left = `${mark.position * 100}%`;
    scale.append(label);
  }

  node.append(head, rail, scale);
  return node;
}

/**
 * The drafted opening message (beyond the spec -- see
 * `backend/app/negotiation/message.py`).
 *
 * The reason it is here rather than left to the buyer: the section's whole output
 * is a number to say to a stranger, and a first-time private-party buyer -- spec
 * 1's target user -- does not know that the comparable prices go BEFORE the
 * figure, which is the difference between a negotiation and a lowball. Presented
 * as a draft in a textarea, not as prose: a message the buyer cannot edit before
 * sending is one they will not send.
 */
function buildDraftMessage(text: string): HTMLElement {
  const node = el("div", "draft");

  const head = el("div", "draft-head");
  head.append(el("span", "draft-label", "Message to send"), copyButton(text, "Copy message"));

  const body = el("textarea", "draft-body") as HTMLTextAreaElement;
  body.value = text;
  body.rows = Math.min(7, text.split("\n").length + 2);
  body.spellcheck = false;
  body.setAttribute("aria-label", "Draft opening message, editable before copying");

  node.append(head, body);
  return node;
}

export function buildNegotiation(data: EvaluationResponse): HTMLElement[] {
  const n = data.negotiation;
  const offer = n.offer;
  const nodes: HTMLElement[] = [];
  const tone = leverageTone(n.leverage);

  // 1. What shape of negotiation this is, then the figures. The stance decides
  // how every number under it reads -- "open at $13,100" against an ask the comps
  // say is $6,000 too high is a different instruction from the same figure on a
  // listing priced fairly.
  const stance = offerStanceChip(offer.stance);
  const steps = offerLadder(n);
  if (stance && steps) {
    const head = el("div", "offer-head");
    head.append(chip(stance.tone, stance.label));
    nodes.push(head);
  }

  if (steps) {
    nodes.push(buildOfferLadder(steps, data.pricing.ask_cents));
  } else if (offer.withheld_reason) {
    // No figure, and the reason is the whole answer. A section that goes quiet
    // without saying why is what this rework was for.
    nodes.push(notePill(offer.withheld_reason));
  }

  // 2. Why those numbers (spec 7.5's "with reasoning"). Prose rather than
  // bullets: each sentence explains a figure directly above it, and a bulleted
  // list of the same text detaches from the numbers it is about.
  //
  // ACTIONABLE SENTENCES ONLY. What the figures are *not* used to live here too,
  // and again as a note below it, and again beside the time-on-market graphic --
  // three blocks of hedging wedged between the offer and the evidence for it. All
  // of that is now one `offer.caveat`, at the bottom of the section.
  for (const line of offer.reasoning) {
    nodes.push(el("p", "muted", line));
  }

  // 3. Time on market, drawn. This is the fact the whole dimension rests on.
  const track = timeOnMarketTrack(n.days_listed);
  if (track) {
    nodes.push(buildTimeTrack(track, tone));
  } else {
    // Stated, not explained. What an unknown posted date MEANS for the figures is
    // the caveat's job, and saying it in both places is what made this section
    // read as one long apology.
    nodes.push(
      el("p", "muted", "Marketplace did not expose a posted date, so time on market is unknown."),
    );
  }

  // 4. The evidence behind the leverage word, as its own labelled group so it
  // reads as supporting detail rather than as a restatement of the reasoning.
  const points = list(n.leverage_points);
  if (points) {
    nodes.push(el("p", "group-label", "What gives you room"));
    nodes.push(points);
  }

  // 5. Seller wording, as chips. These are short quoted phrases scored in
  // opposite directions (spec 6.4), and a chip carries the direction as tone the
  // way a comma-separated table cell could not.
  if (n.motivated_phrases.length || n.rigid_phrases.length) {
    nodes.push(el("p", "group-label", "How the seller writes"));
    const phrases = el("div", "chip-row");
    for (const phrase of n.motivated_phrases) phrases.append(chip("favorable", phrase));
    for (const phrase of n.rigid_phrases) phrases.append(chip("caution", phrase));
    nodes.push(phrases);
  }

  // 6. The message. The thing to do once everything above it has been read.
  if (n.opening_message) {
    nodes.push(buildDraftMessage(n.opening_message));
  }

  // 7. The caveat, LAST and exactly once. It qualifies every figure in the
  // section, so it cannot sit next to any one of them, and a reader working
  // towards the offer should not have to wade through it to get there.
  if (offer.caveat) {
    nodes.push(notePill(offer.caveat));
  }

  return nodes;
}

/* -------------------------------------------------------------------------- */
/* alternatives (spec 6.5)                                                    */
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

  // A nested dropdown, not folded into the list above: these comps are
  // priced better but are NOT the same trim as the target -- a cheaper EX-L
  // is not an alternative to an Si, it is a different car. Not labelled
  // "lower trim": the backend has no ordinal ranking between trim names, only
  // same-vs-different, so this only ever claims "different".
  const differentTrim = data.alternatives.different_trim;
  if (differentTrim.length > 0) {
    const n = differentTrim.length;
    const summary = `${n} different-trim listing${n === 1 ? "" : "s"}, better priced.`;
    const cards = differentTrim.map((alt) => buildAlternativeCard(alt, ask));
    nodes.push(disclosure("Different trim", summary, cards));
  }

  return nodes;
}

/* -------------------------------------------------------------------------- */
/* helpful links (additive; app/links/builder.py)                             */
/* -------------------------------------------------------------------------- */

/**
 * Always exactly two entries (KBB, Consumer Reports) with no minimum-comp or
 * confidence gate, so there is nothing here worth summarising in the
 * disclosure's collapsed row -- "2 outside references" is true on every
 * evaluation and says nothing. Empty string renders no summary at all, same
 * as "Recalls" and "Red flags" elsewhere in this file.
 */
export function helpfulLinksSummary(_data: EvaluationResponse): string {
  return "";
}

/**
 * KBB and Consumer Reports, opened in a new tab. Deliberately identical
 * treatment whether the backend built a direct model-year page or fell back
 * to a site's general landing page: the payload carries no flag saying which
 * happened, and this renders `note` as a plain caveat pill either way rather
 * than a judgement about what the user will find there.
 */
export function buildHelpfulLinks(data: EvaluationResponse): HTMLElement[] {
  return data.helpful_links.map((link) => {
    const node = el("div", "helpful-link");
    node.append(listingLink(link.url, link.label));
    if (link.note) node.append(notePill(link.note));
    return node;
  });
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
  .offer-head { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); }

  /* The offer ladder. A grid rather than flex so the rail's dots line up under
     the middle of their own cells at any number of steps -- both rows share one
     column definition. */
  .ladder {
    margin: 0 0 var(--sp-5); padding: var(--sp-4) var(--sp-5) var(--sp-5);
    border: 1px solid var(--border); border-radius: var(--radius-md);
    background: var(--raised);
  }
  .ladder-cells, .ladder-rail { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; }
  .ladder-cell { min-width: 0; }
  /* Every step after the first reads right-of-centre, so the last one hugs the
     edge and the progression runs left to right rather than sitting in a block. */
  .ladder-cell + .ladder-cell { text-align: right; }
  .ladder[data-steps="3"] .ladder-cell:nth-child(2) { text-align: center; }
  .ladder-label {
    font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .07em;
    text-transform: uppercase; color: var(--text-dim);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ladder-figure {
    margin-top: 3px;
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em; color: var(--text-muted);
  }
  /* The lead step is the only figure the buyer says out loud. */
  .ladder-cell[data-lead="true"] .ladder-figure {
    font-size: var(--fs-xl); font-weight: 700; letter-spacing: -.02em; color: var(--text);
  }
  .ladder-cell[data-lead="true"][data-tone="favorable"] .ladder-figure {
    color: var(--tone-favorable-text);
  }
  .ladder-cell[data-lead="true"][data-tone="caution"] .ladder-figure {
    color: var(--tone-caution-text);
  }
  .ladder-cell[data-lead="true"][data-tone="adverse"] .ladder-figure {
    color: var(--tone-adverse-text);
  }

  /* The rail: a hairline through dots that sit under their own cells. */
  .ladder-rail {
    position: relative; margin-top: var(--sp-4); align-items: center; height: 9px;
  }
  .ladder-rail::before {
    content: ""; position: absolute; left: 4px; right: 4px; top: 50%; height: 1px;
    background: var(--border); transform: translateY(-.5px);
  }
  .ladder-dot {
    position: relative; justify-self: start;
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--track); box-shadow: 0 0 0 2px var(--raised);
  }
  .ladder-rail > .ladder-dot:not(:first-child) { justify-self: end; }
  .ladder[data-steps="3"] .ladder-rail > .ladder-dot:nth-child(2) { justify-self: center; }
  .ladder-dot[data-tone="favorable"] { background: var(--tone-favorable-fill); }
  .ladder-dot[data-tone="caution"]   { background: var(--tone-caution-fill); }
  .ladder-dot[data-tone="adverse"]   { background: var(--tone-adverse-fill); }
  .ladder-caption {
    margin-top: var(--sp-3); font-size: var(--fs-xs); color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  /* time on market ---------------------------------------------------- */
  .timeline { margin-top: var(--sp-5); }
  .timeline-head {
    display: flex; align-items: baseline; gap: var(--sp-3); flex-wrap: wrap;
    margin-bottom: var(--sp-3);
  }
  .timeline-value {
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-base); font-weight: 650; color: var(--text);
  }
  .timeline-phase { font-size: var(--fs-sm); color: var(--text-dim); }
  .timeline-rail {
    position: relative; height: 6px; border-radius: var(--radius-pill);
    background: var(--track);
  }
  .timeline-fill {
    display: block; height: 100%; width: 0; border-radius: inherit;
    background: var(--tone-neutral-fill);
    transition: width var(--dur-slow) var(--ease-out);
  }
  .timeline-fill[data-tone="favorable"] { background: var(--tone-favorable-fill); }
  .timeline-fill[data-tone="caution"]   { background: var(--tone-caution-fill); }
  .timeline-fill[data-tone="adverse"]   { background: var(--tone-adverse-fill); }
  /* The thresholds are reference lines, not data, so they stay recessive and sit
     over the fill rather than interrupting it. */
  .timeline-tick {
    position: absolute; top: -2px; bottom: -2px; width: 1px;
    transform: translateX(-.5px);
    background: var(--text-faint); opacity: .55;
  }
  .timeline-dot {
    position: absolute; top: 50%; width: 11px; height: 11px;
    margin: -5.5px 0 0 -5.5px; border-radius: 50%;
    background: var(--text); box-shadow: 0 0 0 2px var(--sheet), var(--elev-1);
  }
  .timeline-dot[data-tone="favorable"] { background: var(--tone-favorable-fill); }
  .timeline-dot[data-tone="caution"]   { background: var(--tone-caution-fill); }
  .timeline-dot[data-tone="adverse"]   { background: var(--tone-adverse-fill); }
  .timeline-scale {
    position: relative; height: 14px; margin-top: var(--sp-2);
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-2xs); color: var(--text-faint);
  }
  .timeline-scale-label { position: absolute; transform: translateX(-50%); }

  /* shared small pieces ----------------------------------------------- */
  .group-label {
    margin: var(--sp-5) 0 0; font-size: var(--fs-2xs); font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase; color: var(--text-dim);
  }
  .chip-row {
    display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-3);
  }

  /* the drafted message ----------------------------------------------- */
  .draft {
    margin-top: var(--sp-5); padding: var(--sp-4);
    border: 1px solid var(--border); border-radius: var(--radius-md);
    background: var(--raised);
  }
  .draft-head {
    display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4);
    margin-bottom: var(--sp-3);
  }
  .draft-label {
    font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .07em;
    text-transform: uppercase; color: var(--text-dim);
  }
  /* A textarea, because a message nobody can edit before sending is a message
     nobody sends. Inherits the panel's type so it does not read as a form field
     dropped into a report. */
  .draft-body {
    display: block; width: 100%; box-sizing: border-box; resize: vertical;
    padding: var(--sp-3); border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm); background: var(--sheet); color: var(--text-muted);
    font: 400 var(--fs-sm)/1.55 var(--font-sans);
  }
  .draft-body:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }

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

  /* helpful links -------------------------------------------------------- */
  .helpful-link {
    padding: var(--sp-4) 0; border-top: 1px solid var(--border-faint);
    font-size: var(--fs-sm); line-height: 1.5;
  }
  .helpful-link:first-child { border-top: 0; padding-top: var(--sp-1); }
`;
