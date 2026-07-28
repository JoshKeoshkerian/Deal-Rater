/**
 * The panel header, in its two states (spec 7 item 1).
 *
 * CONFIDENT: the score is the answer. Big number, confidence chip, and the
 * expected-price comparison underneath.
 *
 * UNRELIABLE: the score is NOT the answer, so it does not get the big type.
 * The reason does. The engine already detects a weak comp set, widens the
 * interval, drops confidence and refuses to name an offer figure -- and the old
 * header undercut all of it by printing 41 in 34px above the caveats explaining
 * why 41 means nothing. A panel that cannot price a vehicle should be willing
 * to say so as its main answer.
 *
 * The score is not deleted in that state. It is behind one click, because a
 * number a user has asked to see twice is a number they have been told about.
 */

import type { EvaluationResponse } from "../../shared/types";
import { compProblems, headlineState, priceComparison, scoreGrade } from "./state";
import { TONE_GLYPH } from "./tokens";

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A tone chip: colour, glyph and words, never colour alone. */
function chip(tone: string, label: string): HTMLElement {
  const node = el("span", "chip");
  node.dataset["tone"] = tone;
  node.append(
    el("span", "chip-glyph", TONE_GLYPH[tone as keyof typeof TONE_GLYPH] ?? "·"),
    el("span", undefined, label),
  );
  return node;
}

/** Spec 9's beta badge. Always, until the ground truth set exists. */
function betaBadge(): HTMLElement {
  const node = el("span", "beta", "BETA");
  node.title = "Uncalibrated: the weights have not been checked against hand-evaluated listings.";
  return node;
}

function buildConfident(data: EvaluationResponse): HTMLElement[] {
  const { score, suppressed_reason: suppressed, beta } = data.deal_score;

  const row = el("div", "score-row");
  if (score === null) {
    row.append(el("div", "score-withheld", "Score withheld"));
  } else {
    const scoreNode = el("div", "score", `${Math.round(score)}`);
    // Colour AND size, not colour alone -- the digits are still the number,
    // so a reader who cannot tell green from red is not left with nothing.
    scoreNode.dataset["grade"] = scoreGrade(score);
    row.append(scoreNode, el("span", "score-of", "/ 100"));
  }
  if (beta) row.append(betaBadge());

  const comparison = suppressed ?? priceComparison(data.pricing) ?? data.headline;
  return [row, el("p", "headline", comparison)];
}

function buildUnreliable(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const { score, suppressed_reason: suppressed, beta } = data.deal_score;

  // The primary text position, and the point of the whole state: the reason,
  // in the panel's own words, before any number.
  nodes.push(el("p", "verdict", "This vehicle cannot be priced confidently."));

  const problems = compProblems(data.pricing, 2);
  if (problems.length) {
    const list = el("ul", "problems");
    for (const problem of problems) {
      const item = el("li");
      item.append(
        el("span", "problem-glyph", TONE_GLYPH.caution),
        el("span", undefined, problem),
      );
      list.append(item);
    }
    nodes.push(list);
  }

  if (beta) {
    const meta = el("div", "meta-row");
    meta.append(betaBadge());
    nodes.push(meta);
  }

  // The score, behind one click. `suppressed_reason` is the backend declining
  // to publish a number at all (a scam-pattern combination, no price residual),
  // which is a stronger statement than this one and is shown as text instead.
  if (suppressed !== null) {
    nodes.push(el("p", "headline", suppressed));
  } else if (score !== null) {
    const details = el("details", "score-reveal");
    const summary = el("summary", undefined, "Show the score anyway");
    const body = el("p", "score-secondary");
    body.append(
      el("strong", undefined, `${Math.round(score)} / 100`),
      el(
        "span",
        undefined,
        " — a summary of dimensions that rest on the comp set above. It is no more" +
          " reliable than the comps are.",
      ),
    );
    details.append(summary, body);
    nodes.push(details);
  }

  return nodes;
}

export function buildHeader(data: EvaluationResponse, onClose: () => void): HTMLElement {
  const state = headlineState(data);
  const header = el("header");
  header.dataset["state"] = state;

  const close = el("button", "close", "×") as HTMLButtonElement;
  close.type = "button";
  close.setAttribute("aria-label", "Close evaluation");
  close.addEventListener("click", onClose);

  header.append(close, el("div", "vehicle", data.vehicle));
  header.append(
    ...(state === "confident" ? buildConfident(data) : buildUnreliable(data)),
  );
  return header;
}

export const HEADER_STYLES = `
  header {
    position: sticky; top: 0;
    background: var(--sheet);
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border);
  }
  header[data-state="unreliable"] {
    border-bottom-color: var(--tone-caution-border);
    box-shadow: inset 3px 0 0 var(--tone-caution-fill);
  }
  .close {
    position: absolute; top: 12px; right: 14px;
    background: none; border: 0; color: var(--text-dim);
    font-size: 22px; line-height: 1; cursor: pointer; padding: 4px 6px; border-radius: 6px;
  }
  .close:hover { color: var(--text); }
  .vehicle {
    font-size: 12px; color: var(--text-dim);
    letter-spacing: .04em; text-transform: uppercase;
    padding-right: 28px;
  }

  /* confident */
  .score-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .score {
    font-size: 36px; font-weight: 700; line-height: 1; letter-spacing: -.02em;
    color: var(--text); transition: font-size .12s ease;
  }
  /* Grade is a five-way read of the same 0-100 the rest of the panel keeps to
     three tones (Tone) -- justified here because this is the one number
     shown once, in isolation, at the size that draws the eye first. */
  .score[data-grade="poor"]      { color: var(--grade-poor-text);      font-size: var(--grade-poor-size); }
  .score[data-grade="weak"]      { color: var(--grade-weak-text);      font-size: var(--grade-weak-size); }
  .score[data-grade="fair"]      { color: var(--grade-fair-text);      font-size: var(--grade-fair-size); }
  .score[data-grade="good"]      { color: var(--grade-good-text);      font-size: var(--grade-good-size); }
  .score[data-grade="excellent"] { color: var(--grade-excellent-text); font-size: var(--grade-excellent-size); }
  .score-of { font-size: 13px; color: var(--text-faint); margin-left: -4px; }
  .score-withheld { font-size: 17px; font-weight: 600; color: var(--tone-caution-text); }
  .headline { margin: 10px 0 0; font-size: 13px; line-height: 1.5; color: var(--text-muted); }

  /* unreliable */
  .verdict {
    margin: 10px 0 0;
    font-size: 21px; font-weight: 650; line-height: 1.25;
    letter-spacing: -.01em;
    color: var(--text);
  }
  .problems { list-style: none; margin: 10px 0 0; padding: 0; }
  .problems li {
    display: flex; gap: 8px; align-items: baseline;
    font-size: 13.5px; line-height: 1.45; color: var(--text-muted);
    margin-bottom: 4px;
  }
  .problem-glyph { color: var(--tone-caution-text); flex: none; }
  .meta-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }

  .score-reveal { margin-top: 10px; }
  .score-reveal summary {
    font-size: 12px; color: var(--text-dim); cursor: pointer;
    padding: 3px 0; border-radius: 4px; width: fit-content;
  }
  .score-reveal summary:hover { color: var(--text); }
  .score-secondary {
    margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted);
  }
  .score-secondary strong { color: var(--text); font-size: 15px; }

  /* chips and badges */
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11.5px; font-weight: 600;
    padding: 3px 8px; border-radius: 999px;
    border: 1px solid currentColor;
  }
  .chip-glyph { font-size: 11px; }
  .chip[data-tone="favorable"] { color: var(--tone-favorable-text); }
  .chip[data-tone="caution"]   { color: var(--tone-caution-text); }
  .chip[data-tone="adverse"]   { color: var(--tone-adverse-text); }
  .chip[data-tone="neutral"]   { color: var(--text-dim); }
  .beta {
    font-size: 10px; font-weight: 700; letter-spacing: .08em;
    background: var(--beta); color: var(--sheet);
    padding: 3px 6px; border-radius: 4px;
  }
`;
