/**
 * Spec 7's sections, in its order.
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
import {
  compProblems,
  confidenceTone,
  hasOnlyStructuralLimiters,
  headlineState,
  intervalWidthRatio,
  scamDisplay,
  scoreTone,
  titleTone,
} from "./state";

/* -------------------------------------------------------------------------- */
/* 2. pricing (spec 5.1) -- always visible                                    */
/* -------------------------------------------------------------------------- */

/**
 * Spec 4.5, in the pricing block rather than the footer.
 *
 * "Marketplace exposes asking prices, not transaction prices... This
 * distinction is load-bearing and belongs in the UI, not the terms of service."
 * It was in a stack of three grey paragraphs at the bottom of the panel, which
 * is the terms of service with extra steps. One line, attached to the figures
 * it qualifies, at the moment the user is reading them.
 */
const ASKING_PRICE_LINE = "Asking prices, not sale prices — nobody publishes what these sell for.";

export function buildPricing(data: EvaluationResponse): HTMLElement[] {
  const p = data.pricing;
  const nodes: HTMLElement[] = [];

  const figures: Row[] = [["Current ask", money(p.ask_cents), { big: true }]];
  if (p.expected_asking_cents !== null) {
    figures.push([
      "Expected asking",
      `${money(p.asking_interval_low_cents)} – ${money(p.asking_interval_high_cents)}`,
    ]);
  }
  if (p.strong_offer_cents !== null) {
    figures.push(["Strong offer", money(p.strong_offer_cents)]);
    figures.push(["Walk away above", money(p.walk_away_above_cents)]);
  }
  figures.push(["Comps used", `${p.comps_included}`]);
  figures.push(["Confidence", p.confidence, { tone: confidenceTone(p.confidence) }]);
  nodes.push(rows(figures));

  // Inline, not a footnote. A range the panel does not believe should say so
  // where the range is, not 400 pixels below it.
  if (headlineState(data) === "unreliable" && p.expected_asking_cents !== null) {
    const ratio = intervalWidthRatio(p);
    const width = ratio === null ? "" : ` It spans ${Math.round(ratio * 100)}% of its own midpoint.`;
    nodes.push(
      el(
        "p",
        "inline-warning",
        `Treat this range as unreliable.${width} It is the honest width of what the ` +
          "comparable listings support, not a precise estimate.",
      ),
    );
  }

  if (p.strong_offer_cents === null && p.expected_asking_cents !== null) {
    nodes.push(
      el("p", "muted", "No offer figures: the expected range is too wide to name one."),
    );
  }

  nodes.push(el("p", "asking-note", ASKING_PRICE_LINE));
  return nodes;
}

/** The collapsed comp-quality row that sits under the pricing block. */
export function compQualitySummary(data: EvaluationResponse): string {
  const p = data.pricing;

  // Nothing wrong with this comp set beyond what is wrong with every comp set.
  // Leading with "dealer listings could not be filtered out" on a 31-comp fit
  // would repeat the boilerplate this ranking exists to bury.
  if (hasOnlyStructuralLimiters(p)) {
    return `${p.comps_included} comparable listings, nothing unusual limiting them.`;
  }

  const problems = compProblems(p, 1);
  if (problems.length === 0) return `Confidence: ${p.confidence}.`;

  const others = p.confidence_limiters.length - 1;
  return `${problems[0]}${others > 0 ? `, and ${others} more` : ""}.`;
}

export function buildCompQuality(data: EvaluationResponse): HTMLElement[] {
  const p = data.pricing;
  const nodes: HTMLElement[] = [];

  const reasons = list(p.confidence_reasons);
  if (reasons) nodes.push(reasons);

  nodes.push(
    rows([
      ["Estimator", p.estimator.replace(/_/g, " ")],
      ["Comps used", `${p.comps_included}`],
      ["Comps with mileage", `${p.comps_with_mileage}`],
      [
        "Year window",
        `${p.year_window} year${p.year_window === 1 ? "" : "s"}${
          p.year_window_widened ? " (widened)" : ""
        }`,
      ],
    ]),
  );
  return nodes;
}

/* -------------------------------------------------------------------------- */
/* 3. vehicle risk (spec 6.2)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The findings that must be on screen without expanding anything.
 *
 * Spec 6.3: a scam combination is "a distinct, prominent warning rather than a
 * numerical deduction buried in a composite". Used to be a grey bullet.
 *
 * Recalls used to surface here too (spec 6.2 asks for it), but NHTSA has open
 * campaigns against nearly every VIN it's asked about, so the callout fired on
 * almost every listing and stopped reading as a finding -- it was noise, not
 * signal, and the same was true of the recall count folded into the collapsed
 * "Vehicle risk" summary and detail rows. Recall data has been dropped from
 * the panel entirely rather than kept in a form that would fire just as often.
 */
export function buildAdverseFindings(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const risk = data.vehicle_risk;

  // Spec 6.3, and the strongest thing the panel can say. First.
  const seller = data.seller_risk;
  if (seller && scamDisplay(seller) === "warning") {
    nodes.push(
      callout("adverse", "Several scam patterns fired together", [
        `${seller.scam_signals_fired.length} independent signals fired on this listing. ` +
          "Any one of them is weak. This many at once is not, and it is why no deal score " +
          "is shown.",
        list(seller.messages) ?? el("span"),
      ]),
    );
  }

  if (risk.title_risk === "disqualifying" || risk.title_risk === "branded") {
    nodes.push(callout("adverse", `Title: ${risk.title_risk}`, [risk.title_message]));
  }

  return nodes;
}

export function vehicleRiskSummary(data: EvaluationResponse): string {
  const risk = data.vehicle_risk;
  const parts: string[] = [`title ${risk.title_risk}`];
  if (risk.complaint_count !== null) parts.push(`${risk.complaint_count} owner complaints`);
  if (risk.complaint_count === null) {
    parts.push("no NHTSA data for this vehicle");
  }
  return parts.join(", ") + ".";
}

export function buildVehicleRisk(data: EvaluationResponse): HTMLElement[] {
  const risk = data.vehicle_risk;
  const nodes: HTMLElement[] = [];

  const figures: Row[] = [["Title", risk.title_risk, { tone: titleTone(risk.title_risk) }]];
  if (risk.complaint_count !== null) {
    figures.push(["Owner complaints", `${risk.complaint_count}`]);
  }
  if (risk.decoded_spec) figures.push(["VIN decode", risk.decoded_spec]);
  nodes.push(rows(figures));

  if (risk.top_complaint_components.length) {
    nodes.push(el("p", "muted", "Most complained-about systems"));
    nodes.push(
      list(risk.top_complaint_components.map(([name, count]) => `${name.toLowerCase()} (${count})`))!,
    );
  }

  const messages = list([risk.title_message, ...risk.messages]);
  if (messages) nodes.push(messages);
  return nodes;
}

/* -------------------------------------------------------------------------- */
/* 4. seller and scam risk (spec 6.3, 7.4)                                    */
/* -------------------------------------------------------------------------- */

export function sellerRiskSummary(data: EvaluationResponse): string {
  const seller = data.seller_risk;
  if (!seller) return "";
  const parts: string[] = [];
  if (seller.seller_type === "dealer") parts.push("looks like a dealer listing");
  const fired = seller.scam_signals_fired.length;
  if (fired >= 2) parts.push(`${fired} scam-pattern signals fired`);
  return parts.join("; ") + ".";
}

export function buildSellerRisk(data: EvaluationResponse): HTMLElement[] {
  const seller = data.seller_risk;
  if (!seller) return [];
  const nodes: HTMLElement[] = [];

  nodes.push(rows([["Seller", seller.seller_type]]));
  if (seller.dealer_markers.length) {
    nodes.push(el("p", "muted", "What suggests a dealer"));
    nodes.push(list(seller.dealer_markers)!);
  }

  if (seller.seller_rating_average !== null) {
    nodes.push(
      rows([["Marketplace rating", `${seller.seller_rating_average.toFixed(1)} / 5`]]),
    );
  }

  // Spec 6.3 flags combinations. Below two signals nothing is rendered here at
  // all -- see `scamDisplay` -- and at four the warning is already at the top
  // of the panel, so this stays the detail rather than repeating it. A star
  // rating is a separate, independent reason to show `messages` (the backend
  // appends the rating line to the same list), since it can be the ONLY
  // reason this section is visible at all -- see `sellerSectionVisible`.
  if (scamDisplay(seller) !== "hidden" || seller.seller_rating_average !== null) {
    const messages = list(seller.messages);
    if (messages) nodes.push(messages);
    if (seller.scam_reduced_sensitivity) {
      nodes.push(
        el(
          "p",
          "muted",
          `Only ${seller.scam_signals_evaluable} of ${seller.scam_signals_total} patterns ` +
            "could be checked on this listing, so the combination is judged on less.",
        ),
      );
    }
  }
  return nodes;
}

/* -------------------------------------------------------------------------- */
/* 5. negotiation (spec 6.4)                                                  */
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
/* 6. better alternatives (spec 6.5)                                          */
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
/* 7. what to check on this car (spec 6.6)                                    */
/* -------------------------------------------------------------------------- */

export function knownIssuesSummary(data: EvaluationResponse): string {
  const known = data.known_issues;
  if (!known) {
    // Spec 10's verdict, cut to its first sentence. The whole paragraph is
    // inside the row; a summary line is a line.
    const reason = data.known_issues_unavailable_reason ?? "";
    const stop = reason.indexOf(". ");
    return stop === -1 ? reason : `${reason.slice(0, stop + 1)}`;
  }
  const count =
    known.failure_modes.length + known.inspect.length + known.ask.length;
  return count > 0 ? `${count} things to check before buying.` : known.summary;
}

export function buildKnownIssues(data: EvaluationResponse): HTMLElement[] {
  const known = data.known_issues;
  const nodes: HTMLElement[] = [];

  if (!known) {
    // Only reachable for a gate VERDICT; the deployment reasons never render
    // this section at all. See `knownIssuesReasonIsShowable`.
    if (data.known_issues_unavailable_reason) {
      nodes.push(el("p", "muted", data.known_issues_unavailable_reason));
    }
    return nodes;
  }

  nodes.push(el("p", "known-summary", known.summary));

  const groups: Array<[string, string[]]> = [
    ["Known to go wrong", known.failure_modes],
    ["Check on the viewing", known.inspect],
    ["Ask the seller", known.ask],
    ["Living with it", known.ownership_notes],
  ];
  let any = false;
  for (const [label, items] of groups) {
    const ul = list(items);
    if (!ul) continue;
    any = true;
    nodes.push(el("p", "muted", label), ul);
  }
  if (!any) {
    nodes.push(
      el("p", "muted", "No widespread model-specific problems documented for this mileage."),
    );
  }
  return nodes;
}

/* -------------------------------------------------------------------------- */

export const SECTION_STYLES = `
  .inline-warning {
    margin: 12px 0 0; padding: 9px 11px;
    font-size: 12.5px; line-height: 1.5;
    color: var(--tone-caution-text);
    background: var(--tone-caution-surface);
    border: 1px solid var(--tone-caution-border);
    border-radius: 6px;
  }
  .asking-note {
    margin: 12px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--text-dim);
  }
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
