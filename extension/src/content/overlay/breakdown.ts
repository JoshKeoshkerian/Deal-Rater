/**
 * Spec 5.2's breakdown: the four dimensions behind the one number.
 *
 * EXPERIMENT: the breakdown as the star of the show. Each dimension bar is its
 * own dropdown, and expanding one reveals everything that dimension is made
 * of -- Pricing under price residual, a completeness readout under
 * information completeness, recalls plus the model's read under vehicle risk,
 * red flags plus seller questions under seller and scam risk. Negotiation and
 * Better alternatives stay separate disclosures elsewhere in the panel; they
 * are not deal-score dimensions (spec 6.4), so they have no bar to hang off.
 *
 * THE BAR LENGTH IS THE CONTRIBUTION, NOT THE SUB-SCORE
 * -----------------------------------------------------
 * It used to be the raw sub-score, which made information completeness -- 9% of
 * the number -- draw a bar as long as price residual at 56%. Comparing those
 * bars compared nothing. Each row now draws a track proportional to the
 * dimension's weight and fills it by the sub-score, so the filled length is
 * weight x score: the points that dimension actually put into the headline.
 * The filled lengths sum to the score.
 *
 * WHICH WEIGHTS ARE PRINTED
 * -------------------------
 * The normalised ones the backend sends (56 / 9 / 25 / 10), shown verbatim as
 * percentages. Spec 5.2 describes the same four weights in their raw form
 * (45 / 7 / 20 / 8, totalling 80) and then rescales them to 100 "so the UI can
 * show each one verbatim as a percent next to its dimension". Both are the same
 * ratios; this is the representation that can be printed with a % sign after it
 * without lying, so it is the one used. `evaluation/score.py` holds the
 * derivation.
 */

import type { EvaluationResponse } from "../../shared/types";
import { el, list } from "./elements";
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
 * listing with no vehicle-risk reading gives price residual 75% of the score
 * rather than its nominal 56 -- and printing "38/100 × 56% = 28.4 pts" would be
 * arithmetic that does not work, in front of a reader who is entitled to check
 * it. With full coverage the two are identical and this prints 56 either way.
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
  const node = el("details", `component${points === null ? " missing" : ""}`);
  const summary = el("summary", "component-summary");

  const body = componentDetail(component.name, data);

  const top = el("div", "component-top");
  top.append(el("span", "component-name", label(component.name)));
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
    fill.dataset["tone"] = scoreTone(component.value);
    fill.style.width = `${Math.max(0, Math.min(100, component.value ?? 0))}%`;
    track.append(fill);
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
  // lowest: a weak reading on 9% of the score is not what dragged anything down.
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

  const summary = breakdownSummary(data);
  if (summary) {
    nodes.push(el("p", "breakdown-note", summary));
  }

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
  .component { border-bottom: 1px solid var(--border-faint); font-size: 12px; }
  .component:last-child { border-bottom: 0; }
  .component-summary {
    display: block; cursor: pointer; list-style: none; position: relative;
    padding: 9px 18px 11px 0;
  }
  .component-summary::-webkit-details-marker { display: none; }
  .component-summary::after {
    content: "+"; position: absolute; right: 0; top: 9px;
    color: var(--text-faint); font-size: 14px; line-height: 1;
  }
  .component[open] > .component-summary::after { content: "−"; }
  .component-summary:hover .component-name { color: var(--text); }
  .component-top {
    display: flex; justify-content: space-between; gap: 12px;
    color: var(--text-muted); align-items: baseline;
  }
  .component-name { text-transform: capitalize; }
  .component-figures { font-variant-numeric: tabular-nums; color: var(--text-dim); flex: none; }
  .component.missing .component-top { color: var(--text-faint); font-style: italic; }
  .component-reason {
    margin: 3px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--text-faint);
  }
  .bar {
    height: 6px; border-radius: 3px; background: var(--track);
    margin-top: 5px; overflow: hidden; min-width: 8%;
  }
  .bar > i { display: block; height: 100%; background: var(--tone-neutral-fill); }
  .bar > i[data-tone="favorable"] { background: var(--tone-favorable-fill); }
  .bar > i[data-tone="caution"]   { background: var(--tone-caution-fill); }
  .bar > i[data-tone="adverse"]   { background: var(--tone-adverse-fill); }
  .component-body { padding: 0 0 14px; }

  /* Vehicle risk / seller and scam risk's own nested dropdowns (Recalls,
     Known issues, Red flags, Questions). Indented from "Vehicle risk" /
     "Seller and scam risk" itself, with their own content indented a second
     step further from THEIR header -- two levels, not one, per the request
     that started this. Overrides the shared .disclosure spacing, which is
     sized for a full-width top-level row rather than a nested one. */
  .component-body > .disclosure { border-bottom: 1px solid var(--border-faint); }
  .component-body > .disclosure:last-child { border-bottom: 0; }
  .component-body > .disclosure:first-of-type { margin-top: 4px; }
  .component-body > .disclosure > summary { padding: 8px 0 8px 14px; }
  .component-body > .disclosure > .disclosure-body { padding: 2px 0 10px 28px; }

  .breakdown-note {
    margin: 0 0 12px; font-size: 12.5px; line-height: 1.5; color: var(--text-muted);
  }
  .muted-list { color: var(--text-faint); font-size: 11.5px; margin-top: 10px; }
`;
