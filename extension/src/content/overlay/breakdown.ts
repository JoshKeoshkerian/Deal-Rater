/**
 * Spec 5.2's breakdown: the four dimensions behind the one number.
 *
 * Spec 5.2 is unambiguous that this travels with the score -- the composite "is
 * a summary of the separated dimensions in section 6, not a replacement for
 * them, and the UI should always show the breakdown alongside it."
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
import { breakdownIsFlat, contributions, scoreTone, FLAT_BREAKDOWN_SPREAD } from "./state";

function label(name: string): string {
  return name.replace(/_/g, " ");
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
  component: EvaluationResponse["deal_score"]["components"][number],
  points: number | null,
  maxPoints: number,
  widest: number,
): HTMLElement {
  const row = el("div", `component${points === null ? " missing" : ""}`);

  const top = el("div", "component-top");
  top.append(el("span", "component-name", label(component.name)));
  top.append(
    el(
      "span",
      "component-figures",
      points === null ? "not assessed" : figures(component.value ?? 0, maxPoints, points),
    ),
  );
  row.append(top);

  if (points === null) {
    if (component.unavailable_reason) {
      row.append(el("p", "component-reason", component.unavailable_reason));
    }
    return row;
  }

  // The track is the dimension's whole weight; the fill is what it scored of
  // it. Both are drawn against the widest track so the weights are comparable
  // across rows at a glance.
  const track = el("div", "bar");
  track.style.width = `${(maxPoints / widest) * 100}%`;
  const fill = el("i");
  fill.dataset["tone"] = scoreTone(component.value);
  fill.style.width = `${Math.max(0, Math.min(100, component.value ?? 0))}%`;
  track.append(fill);
  row.append(track);
  return row;
}

/** The one-line summary shown on the collapsed row. */
export function breakdownSummary(data: EvaluationResponse): string {
  const rows = contributions(data.deal_score.components).filter((r) => r.points !== null);
  if (rows.length === 0) return "No dimension could be assessed.";

  if (breakdownIsFlat(data.deal_score.components)) {
    return "All four dimensions scored within a few points of each other.";
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

  const values = data.deal_score.components
    .map((c) => c.value)
    .filter((value): value is number => value !== null);

  // Four near-identical bars answer "what dragged this down?" with "nothing",
  // in the most expensive way available. One sentence answers it better, and
  // the figures stay underneath for anyone who wants them.
  const flat = breakdownIsFlat(data.deal_score.components);
  if (flat) {
    nodes.push(
      el(
        "p",
        "flat-note",
        `Nothing stands out: every assessed dimension scored between ` +
          `${Math.round(Math.min(...values))} and ${Math.round(Math.max(...values))}, ` +
          `a spread of under ${FLAT_BREAKDOWN_SPREAD} points. The headline is the average, ` +
          `not a verdict driven by one weak reading.`,
      ),
    );
  }

  const widest = Math.max(...rows.map((r) => r.maxPoints), 1);
  for (const { component, points, maxPoints } of rows) {
    if (flat && points !== null) {
      const line = el("div", "component compact");
      const top = el("div", "component-top");
      top.append(
        el("span", "component-name", label(component.name)),
        el("span", "component-figures", figures(component.value ?? 0, maxPoints, points)),
      );
      line.append(top);
      nodes.push(line);
      continue;
    }
    nodes.push(bar(component, points, maxPoints, widest));
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
  .component { margin-bottom: 11px; font-size: 12px; }
  .component:last-child { margin-bottom: 0; }
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
  .flat-note {
    margin: 0 0 12px; font-size: 12.5px; line-height: 1.5; color: var(--text-muted);
  }
  .muted-list { color: var(--text-faint); font-size: 11.5px; margin-top: 10px; }
`;
