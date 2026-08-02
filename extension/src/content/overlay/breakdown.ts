/**
 * Spec 5.2's breakdown: the four dimensions behind the one number.
 *
 * EXPERIMENT: the breakdown as the star of the show. Each dimension bar is its
 * own dropdown, and expanding one reveals everything that dimension is made
 * of -- Pricing under price residual, a completeness readout under
 * information completeness, recalls plus the model's read under vehicle risk,
 * red flags plus seller questions under seller and scam risk. Negotiation and
 * Alternatives stay separate disclosures elsewhere in the panel; they
 * are not deal-score dimensions (spec 6.4), so they have no bar to hang off.
 *
 * THE BAR LENGTH IS THE CONTRIBUTION, NOT THE SUB-SCORE
 * -----------------------------------------------------
 * It used to be the raw sub-score, which made information completeness -- 10% of
 * the number -- draw a bar as long as price residual at 50%. Comparing those
 * bars compared nothing. Each row now draws a track proportional to the
 * dimension's weight and fills it by the sub-score, so the filled length is
 * weight x score: the points that dimension actually put into the headline.
 * The filled lengths sum to the score.
 *
 * WHICH WEIGHTS ARE PRINTED
 * -------------------------
 * The normalised ones the backend sends (50 / 10 / 25 / 15), shown verbatim as
 * percentages. `evaluation/score.py` holds the derivation and history --
 * these have already been rescaled once (spec 5.2) and reweighted once since
 * (2026-07-29) -- this file just prints whatever it is handed, so it is the
 * one used. Both prior and current values are the same shape: a set of
 * weights totalling 100, one per dimension, that can be printed with a %
 * sign after each without lying.
 */

import type { EvaluationResponse } from "../../shared/types";
import { el, fillsTo, list } from "./elements";
import { TONE_GLYPH } from "./tokens";
import {
  buildCompleteness,
  buildPricing,
  buildSellerScamRiskDetail,
  buildVehicleRiskDetail,
} from "./sections";
import { breakdownIsFlat, contributions, scoreTone } from "./state";

function label(name: string): string {
  return name.replace(/_/g, " ");
}

/**
 * What each dimension's dropdown contains. The AI pill used to sit here, on
 * the bar itself, for vehicle risk and seller/scam risk; it now sits inside
 * `buildVehicleRiskDetail`/`buildSellerScamRiskDetail`'s own nested "Known
 * issues"/"Questions" dropdowns instead, marking exactly the content that
 * leans on the model rather than everything under the bar.
 */
function componentDetail(name: string, data: EvaluationResponse): HTMLElement[] {
  switch (name) {
    case "price_residual":
      return buildPricing(data);
    case "information_completeness":
      return buildCompleteness(data);
    case "vehicle_risk":
      return buildVehicleRiskDetail(data);
    case "seller_and_scam_risk":
      return buildSellerScamRiskDetail(data);
    default:
      return [];
  }
}

/**
 * The equation on each row, written so that it balances.
 *
 * The percentage is the RENORMALISED weight, not the nominal one. When a
 * dimension cannot be assessed its weight is shared out over the rest, so a
 * listing with no vehicle-risk reading gives price residual two thirds of the
 * score rather than its nominal 50% -- and printing "38/100 × 50% = 19.0 pts"
 * would be arithmetic that does not work, in front of a reader who is
 * entitled to check it. With full coverage the two are identical and this
 * prints 50 either way.
 */
function figures(value: number, maxPoints: number, points: number): string {
  return `${Math.round(value)}/100 × ${Math.round(maxPoints)}% = ${points.toFixed(1)} pts`;
}

function bar(
  data: EvaluationResponse,
  component: EvaluationResponse["deal_score"]["components"][number],
  points: number | null,
  maxPoints: number,
  widest: number,
): HTMLElement {
  const tone = scoreTone(component.value);
  const node = el("details", `component${points === null ? " missing" : ""}`);
  if (points !== null) node.dataset["tone"] = tone;

  const summary = el("summary", "component-summary");
  const body = componentDetail(component.name, data);

  const top = el("div", "component-top");
  const name = el("span", "component-name");
  // The glyph is the tone's second carrier (tokens.ts, rule 1). The bar below
  // is coloured, and a bar is exactly the kind of element a reader with a
  // red-green deficiency gets nothing from.
  if (points !== null) name.append(el("span", "component-glyph", TONE_GLYPH[tone]));
  name.append(el("span", undefined, label(component.name)));
  top.append(name);
  top.append(
    el(
      "span",
      "component-figures",
      points === null ? "not assessed" : figures(component.value ?? 0, maxPoints, points),
    ),
  );
  summary.append(top);

  // The track is the dimension's whole weight; the fill is what it scored of
  // it. Both are drawn against the widest track so the weights are comparable
  // across rows at a glance. Skipped entirely when unassessed -- there is no
  // sub-score to draw.
  if (points !== null) {
    const track = el("div", "bar");
    track.style.width = `${(maxPoints / widest) * 100}%`;
    const fill = el("i");
    fill.dataset["tone"] = tone;
    // Grown from zero once the panel is on screen, in the same pass as every
    // other fill -- see `animateFills`. The four rows are staggered in CSS so
    // they read as one chart arriving rather than four bars racing.
    track.append(fillsTo(fill, (component.value ?? 0) / 100));
    summary.append(track);
  }

  node.append(summary);

  const inner = el("div", "component-body");
  if (points === null && component.unavailable_reason) {
    inner.append(el("p", "component-reason", component.unavailable_reason));
  }
  inner.append(...body);
  node.append(inner);

  return node;
}

/**
 * The one-line finding shown above the bars, when there is one to make.
 *
 * Empty when the sub-scores are too close together to say anything -- "all
 * four dimensions scored within a few points of each other" is not a finding,
 * it is a description of the chart sitting directly below it, so it is left
 * unsaid rather than spelled out in a sentence nobody needed.
 */
export function breakdownSummary(data: EvaluationResponse): string {
  const rows = contributions(data.deal_score.components).filter((r) => r.points !== null);
  if (rows.length === 0) return "No dimension could be assessed.";

  if (breakdownIsFlat(data.deal_score.components)) {
    return "";
  }

  // The dimension that gave away the most points, not the one that scored
  // lowest: a weak reading on 10% of the score is not what dragged anything down.
  const weakest = rows.reduce((worst, row) =>
    row.maxPoints - (row.points ?? 0) > worst.maxPoints - (worst.points ?? 0) ? row : worst,
  );
  return (
    `${label(weakest.component.name)} dragged this down: ` +
    `${Math.round(weakest.component.value ?? 0)}/100 on ` +
    `${Math.round(weakest.maxPoints)}% of the score.`
  );
}

export function buildBreakdown(data: EvaluationResponse): HTMLElement[] {
  const rows = contributions(data.deal_score.components);
  const nodes: HTMLElement[] = [];

  // Always drawn, flat or not -- spec 5.2 wants the breakdown alongside the
  // score every time, not only when one dimension is worth calling out.
  const widest = Math.max(...rows.map((r) => r.maxPoints), 1);
  for (const { component, points, maxPoints } of rows) {
    nodes.push(bar(data, component, points, maxPoints, widest));
  }

  const missing = rows.filter((r) => r.points === null);
  if (missing.length) {
    nodes.push(
      el(
        "p",
        "muted",
        "Dimensions that could not be assessed are dropped rather than scored as zero, " +
          "and the remaining weights are shared out over what is left.",
      ),
    );
  }

  const fallback = list(data.pricing.fallback_reasons, "muted-list");
  if (fallback) nodes.push(fallback);

  return nodes;
}

export const BREAKDOWN_STYLES = `
  .component {
    position: relative; border-bottom: 1px solid var(--border-faint);
    font-size: var(--fs-sm);
  }
  .component:last-child { border-bottom: 0; }
  /* A tone rail on the left edge, drawn only while the row is open. Closed,
     the bar is already the colour carrier; open, the row's content runs for
     half a screen and the rail is what still connects it to its dimension. */
  .component::before {
    content: ""; position: absolute; left: calc(var(--sp-4) * -1); top: 0; bottom: 0;
    width: 2px; border-radius: var(--radius-pill); background: transparent;
    transition: background var(--dur-base) var(--ease-out);
  }
  .component[open][data-tone="favorable"]::before { background: var(--tone-favorable-fill); }
  .component[open][data-tone="caution"]::before   { background: var(--tone-caution-fill); }
  .component[open][data-tone="adverse"]::before   { background: var(--tone-adverse-fill); }
  .component[open][data-tone="neutral"]::before   { background: var(--border); }

  .component-summary {
    display: block; cursor: pointer; list-style: none; position: relative;
    padding: var(--sp-3) var(--sp-5) var(--sp-3) 0;
    border-radius: var(--radius-sm);
    transition: background var(--dur-fast) var(--ease-out);
  }
  .component-summary::-webkit-details-marker { display: none; }
  .component-summary::after {
    content: ""; position: absolute; right: 2px; top: 14px;
    width: 6px; height: 6px;
    border-right: 1.5px solid var(--text-faint);
    border-bottom: 1.5px solid var(--text-faint);
    transform: rotate(45deg);
    transition: transform var(--dur-base) var(--ease-out), border-color var(--dur-fast);
  }
  .component[open] > .component-summary::after { transform: translateY(3px) rotate(-135deg); }
  .component-summary:hover .component-name { color: var(--text); }
  .component-summary:hover::after { border-color: var(--text-dim); }

  .component-top {
    display: flex; justify-content: space-between; gap: var(--sp-4);
    color: var(--text-muted); align-items: baseline;
  }
  .component-name {
    display: inline-flex; align-items: baseline; gap: var(--sp-2);
    text-transform: capitalize; font-weight: 600;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .component-glyph { font-size: var(--fs-xs); }
  .component[data-tone="favorable"] .component-glyph { color: var(--tone-favorable-text); }
  .component[data-tone="caution"] .component-glyph   { color: var(--tone-caution-text); }
  .component[data-tone="adverse"] .component-glyph   { color: var(--tone-adverse-text); }
  .component[data-tone="neutral"] .component-glyph   { color: var(--text-faint); }

  .component-figures {
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    color: var(--text-dim); flex: none; font-size: var(--fs-xs);
  }
  .component.missing .component-top { color: var(--text-faint); font-style: italic; }
  .component-reason {
    margin: 3px 0 0; font-size: var(--fs-xs); line-height: 1.45; color: var(--text-faint);
  }

  .bar {
    height: 7px; border-radius: var(--radius-pill); background: var(--track);
    margin-top: var(--sp-2); overflow: hidden; min-width: 8%;
  }
  .bar > i {
    display: block; height: 100%; width: 0; border-radius: inherit;
    background: var(--tone-neutral-fill);
    transition: width var(--dur-slow) var(--ease-out);
  }
  .bar > i[data-tone="favorable"] { background: var(--tone-favorable-fill); }
  .bar > i[data-tone="caution"]   { background: var(--tone-caution-fill); }
  .bar > i[data-tone="adverse"]   { background: var(--tone-adverse-fill); }
  /* Staggered so the four dimensions read as one chart arriving rather than
     four independent bars. Nth-of-type, not a class, because the row order is
     fixed by DIMENSION_ORDER in state.ts and cannot drift. */
  .component:nth-of-type(2) .bar > i { transition-delay: 60ms; }
  .component:nth-of-type(3) .bar > i { transition-delay: 120ms; }
  .component:nth-of-type(4) .bar > i { transition-delay: 180ms; }

  .component-body { padding: 0 0 var(--sp-4); }

  /* Vehicle risk / seller and scam risk's own nested dropdowns (Recalls,
     Complaints, Vehicle specification, Red flags). Indented from "Vehicle
     risk" / "Seller and scam risk" itself, with their own content indented a
     second step further from THEIR header -- two levels, not one. Overrides
     the shared .disclosure spacing, which is sized for a full-width top-level
     row rather than a nested one. */
  .component-body > .disclosure { border-bottom: 1px solid var(--border-faint); }
  .component-body > .disclosure:last-child { border-bottom: 0; }
  .component-body > .disclosure:first-of-type { margin-top: var(--sp-1); }
  .component-body > .disclosure > summary {
    padding: var(--sp-3) 0 var(--sp-3) var(--sp-4); border-radius: var(--radius-sm);
  }
  .component-body > .disclosure > .disclosure-body {
    padding: var(--sp-1) 0 var(--sp-4) var(--sp-7);
  }

  .breakdown-note {
    margin: 0 0 var(--sp-4); font-size: var(--fs-sm); line-height: 1.5; color: var(--text-muted);
  }
  .muted-list { color: var(--text-faint); font-size: var(--fs-xs); margin-top: var(--sp-4); }

  /* expand-all, pinned to the Score breakdown heading */
  .toggle-all {
    margin-left: auto; flex: none;
    font: 650 var(--fs-xs)/1 var(--font-sans); letter-spacing: .04em; text-transform: uppercase;
    background: none; border: 1px solid var(--border); border-radius: var(--radius-pill);
    color: var(--text-dim); padding: var(--sp-1) var(--sp-3); cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out);
  }
  .toggle-all:hover { color: var(--text); border-color: var(--text-faint); }
`;
