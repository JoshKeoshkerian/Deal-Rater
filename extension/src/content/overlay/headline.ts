/**
 * The panel header, in its two states (spec 7 item 1).
 *
 * CONFIDENT: the score is the answer. Big number in a dial reading the same
 * 0-100, a confidence chip, and the expected-price comparison underneath.
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
 *
 * WHY THE HEADER IS TINTED AND NOTHING ELSE IS
 * --------------------------------------------
 * `data-grade` on the header washes it with a few percent of the grade colour.
 * That is the one place the panel uses colour as ATMOSPHERE rather than as a
 * flag, and it is defensible only because the grade is already stated three
 * other ways in the same 80 pixels: the digits, the dial, and the size of the
 * digits. The tint tells a returning user which kind of listing this is before
 * they have read anything; it is never the only thing that does.
 */

import type { EvaluationResponse } from "../../shared/types";
import { chip, el, prefersReducedMotion } from "./elements";
import { compProblems, headlineState, priceComparison, scoreGrade } from "./state";
import { TONE_GLYPH, type Tone } from "./tokens";

/** Spec 9's beta badge. Always, until the ground truth set exists. */
function betaBadge(): HTMLElement {
  const node = el("span", "beta", "BETA");
  node.title = "Uncalibrated: the weights have not been checked against hand-evaluated listings.";
  return node;
}

const SELLER_TYPE_TEXT: Record<string, { label: string; description: string }> = {
  private_party: {
    label: "Private party",
    description: "Sold directly by the vehicle's owner, not a dealership.",
  },
  dealer: {
    label: "Dealer",
    description:
      "Sold by a dealership rather than a private owner. The asking price may include " +
      "reconditioning, a warranty, and dealer fees that this tool's private-party comps do not.",
  },
};

/**
 * Private party vs. dealer, top right next to the close button -- spec 1's
 * first differentiator is that this tool's comps are private-party listings,
 * so whether the listing being evaluated is one itself is worth seeing before
 * reading anything else. Hover-only description (the `betaBadge` pattern
 * above), since one word plus a glyph is the whole story until asked for more.
 * Null when Facebook did not state it (`serialize.py`'s `_seller_type_label`),
 * which is common enough that no badge is shown rather than guessing.
 *
 * DISABLED, 2026-07-30: pulled from the UI ahead of a production push.
 * Re-enabled briefly the same day on the theory that the `vehicle_seller_type`
 * fix in `negotiation/seller_type.py` had resolved it; still not accurate
 * enough in practice, so it is hidden again. That backend fix is still real
 * (it corrects `negotiation.seller.is_dealer`, comp-set exclusion, and the
 * offer/leverage logic) -- what remains unreliable is specifically
 * `vehicle_seller_type` itself: Facebook does not always state it, and
 * misclassifies some listings it does state. Re-enabling is dropping this
 * early return; nothing needs to be recomputed.
 */
function buildSellerTypeBadge(_data: EvaluationResponse): HTMLElement | null {
  return null;
}

/** disqualifying/branded read as adverse, unstated as caution, clean as favorable. */
function titleTone(titleRisk: string): Tone {
  if (titleRisk === "disqualifying" || titleRisk === "branded") return "adverse";
  if (titleRisk === "unstated") return "caution";
  return "favorable";
}

/**
 * Title status, promoted out of the red-flags list and up to the headliner:
 * of everything on a listing, title is the fact most likely to change whether
 * this is a car worth buying at all, so it sits right under the score's own
 * descriptive line rather than a click away inside "Seller and scam risk".
 * Shown in both header states -- an unreliable price estimate does not make
 * the title question go away.
 */
function buildTitleStatus(data: EvaluationResponse): HTMLElement {
  const risk = data.vehicle_risk;
  const label = data.vehicle_details.title_status
    ? `Title: ${data.vehicle_details.title_status}`
    : "Title status not stated";

  const node = el("div", "title-status");
  node.append(chip(titleTone(risk.title_risk), label));
  node.append(el("p", "title-status-message", risk.title_message));
  return node;
}

/**
 * Ramp the digits from zero to the score.
 *
 * The final value is written into the node FIRST and the ramp only starts on
 * the next frame, which is what keeps the number correct for anything reading
 * the markup synchronously -- the preview harness lifts `outerHTML` the instant
 * the panel is built, and an animation that begins at "0" would put a zero in
 * every screenshot of it.
 */
function countUp(node: HTMLElement, to: number): void {
  if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") return;

  const duration = 620;
  let start: number | null = null;

  const step = (now: number) => {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / duration);
    // Ease out cubic: fast enough to read as instant response, slow enough at
    // the end that the last few points land rather than snap.
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = `${Math.round(to * eased)}`;
    if (t < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(() => {
    node.textContent = "0";
    requestAnimationFrame(step);
  });
}

/**
 * The score, its dial, and the "out of 100" it is measured against.
 *
 * The dial is a redundant reading of the digits, on purpose: it is the fastest
 * way to see that 74 is nearer the top than the middle without doing the
 * arithmetic, and it costs nothing because the number is right there for anyone
 * who wants the precise value.
 */
function buildScore(score: number, beta: boolean): HTMLElement {
  const grade = scoreGrade(score);
  const rounded = Math.round(score);

  const wrap = el("div", "score-wrap");
  const ring = el("div", "score-ring");
  ring.dataset["grade"] = grade;
  ring.style.setProperty("--dr-dial", `${Math.max(0, Math.min(100, rounded))}%`);

  const value = el("div", "score", `${rounded}`);
  value.dataset["grade"] = grade;
  countUp(value, rounded);

  wrap.append(ring, value);

  const side = el("div", "score-side");
  side.append(el("span", "score-of", "out of 100"));
  if (beta) side.append(betaBadge());

  const row = el("div", "score-row");
  row.append(wrap, side);
  return row;
}

function buildConfident(data: EvaluationResponse): HTMLElement[] {
  const { score, suppressed_reason: suppressed, beta } = data.deal_score;

  let row: HTMLElement;
  if (score === null) {
    row = el("div", "score-row");
    row.append(el("div", "score-withheld", "Score withheld"));
    if (beta) row.append(betaBadge());
  } else {
    row = buildScore(score, beta);
  }

  const comparison = suppressed ?? priceComparison(data.pricing) ?? data.headline;
  return [row, el("p", "headline", comparison), buildTitleStatus(data)];
}

function buildUnreliable(data: EvaluationResponse): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const { score, suppressed_reason: suppressed, beta } = data.deal_score;

  // The primary text position, and the point of the whole state: the reason,
  // in the panel's own words, before any number.
  nodes.push(el("p", "verdict", "This vehicle cannot be priced confidently."));
  nodes.push(buildTitleStatus(data));

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

/**
 * `themeControl` and `saveControl` are built by `index.ts` rather than here:
 * one reads and writes settings and the other talks to the backend, and this
 * module renders an evaluation. Both are optional so the preview harness can
 * call `buildHeader` with two arguments and get a header with no control it
 * cannot wire up.
 */
export function buildHeader(
  data: EvaluationResponse,
  onClose: () => void,
  themeControl?: HTMLElement,
  saveControl?: HTMLElement,
): HTMLElement {
  const state = headlineState(data);
  const header = el("header");
  header.dataset["state"] = state;
  if (state === "confident" && data.deal_score.score !== null) {
    header.dataset["grade"] = scoreGrade(data.deal_score.score);
  }

  const close = el("button", "close") as HTMLButtonElement;
  close.type = "button";
  close.setAttribute("aria-label", "Close evaluation");
  close.append(el("span", "close-glyph", "×"));
  close.addEventListener("click", onClose);

  const actions = el("div", "header-actions");
  const sellerTypeBadge = buildSellerTypeBadge(data);
  if (sellerTypeBadge) actions.append(sellerTypeBadge);
  // Left of the theme toggle: save is about this evaluation, theme is about
  // the panel, and the one that acts on the content sits closer to it. Close
  // stays last, where a close button belongs.
  if (saveControl) actions.append(saveControl);
  if (themeControl) actions.append(themeControl);
  actions.append(close);

  // The vehicle line and the actions used to share a row via absolute
  // positioning, with the vehicle text reserving a fixed 108px of padding to
  // stay clear of it. That number was a guess against the SHORTEST case
  // (private-party badge absent): "Dealer" plus the theme toggle plus close
  // already runs past it, and "Private party" -- the badge on most listings --
  // overlapped the vehicle text outright. A flex row lets the vehicle text
  // shrink and wrap instead of guessing a width for however many controls
  // happen to be present.
  const top = el("div", "header-top");
  top.append(el("div", "vehicle", data.vehicle), actions);
  header.append(top);
  header.append(
    ...(state === "confident" ? buildConfident(data) : buildUnreliable(data)),
  );
  return header;
}

export const HEADER_STYLES = `
  /* The dial's sweep is a registered property so it can be transitioned --
     a plain custom property in a conic-gradient jumps. Namespaced because
     @property registers document-wide, and this stylesheet is injected into
     somebody else's page. */
  @property --dr-dial {
    syntax: "<percentage>";
    inherits: false;
    initial-value: 0%;
  }

  header {
    position: sticky; top: 0; z-index: 1;
    background: var(--sheet);
    padding: var(--sp-6) var(--sp-6) var(--sp-5);
    border-bottom: 1px solid var(--border);
  }
  /* A few percent of the grade colour, mixed into the sheet rather than laid
     over it, so the header is still the sheet in both themes. */
  header[data-grade="poor"]      { background: color-mix(in srgb, var(--grade-poor-text) 7%, var(--sheet)); }
  header[data-grade="weak"]      { background: color-mix(in srgb, var(--grade-weak-text) 7%, var(--sheet)); }
  header[data-grade="fair"]      { background: color-mix(in srgb, var(--grade-fair-text) 7%, var(--sheet)); }
  header[data-grade="good"]      { background: color-mix(in srgb, var(--grade-good-text) 7%, var(--sheet)); }
  header[data-grade="excellent"] { background: color-mix(in srgb, var(--grade-excellent-text) 9%, var(--sheet)); }
  header[data-state="unreliable"] {
    border-bottom-color: var(--tone-caution-border);
    box-shadow: inset 3px 0 0 var(--tone-caution-fill);
    background: color-mix(in srgb, var(--tone-caution-fill) 6%, var(--sheet));
  }

  /* The row the vehicle line and the controls share. Flex rather than the
     vehicle text reserving a fixed width for whatever the actions happen to
     add up to (a seller-type badge, a theme toggle, close): the actions take
     only the width they need and the vehicle text shrinks and wraps around
     them instead of running underneath. */
  .header-top {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: var(--sp-4);
  }
  .header-actions {
    display: flex; align-items: center; gap: var(--sp-2); flex: none;
    /* Nudged up to sit level with the vehicle text's cap-height rather than
       its line box. */
    margin-top: -2px;
  }
  .close, .theme-toggle {
    display: grid; place-items: center; flex: none;
    width: 28px; height: 28px; padding: 0;
    background: none; border: 1px solid transparent; border-radius: var(--radius-pill);
    color: var(--text-dim); cursor: pointer; font: inherit; line-height: 1;
    transition: color var(--dur-fast) var(--ease-out),
                background var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out);
  }
  .close:hover, .theme-toggle:hover {
    color: var(--text); background: var(--raised); border-color: var(--border);
  }
  .close-glyph { font-size: var(--fs-lg); }
  .theme-toggle { font-size: var(--fs-base); }

  .seller-type-badge {
    font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .04em;
    padding: 3px var(--sp-3); border-radius: var(--radius-pill);
    border: 1px solid currentColor; cursor: default; white-space: nowrap;
    flex: none;
  }
  .seller-type-badge[data-type="private_party"] { color: var(--tone-favorable-text); }
  .seller-type-badge[data-type="dealer"] { color: var(--tone-caution-text); }

  .vehicle {
    font-size: var(--fs-sm); color: var(--text-dim);
    letter-spacing: .05em; text-transform: uppercase; font-weight: 600;
    min-width: 0; flex: 1 1 auto;
    /* Long year/make/model/trim combinations wrap onto a second line rather
       than truncating -- this is the one place in the panel that states what
       the car actually is, so losing the end of it silently is worse than a
       taller header. */
    overflow-wrap: break-word;
    padding-top: 2px;
  }

  /* confident --------------------------------------------------------- */
  .score-row {
    display: flex; align-items: center; flex-wrap: wrap;
    gap: var(--sp-4); margin-top: var(--sp-4);
  }
  .score-wrap { position: relative; display: grid; place-items: center; flex: none; }
  .score-ring {
    grid-area: 1 / 1; width: 88px; height: 88px; border-radius: 50%;
    background: conic-gradient(from -90deg, var(--dial) var(--dr-dial), var(--track) 0);
    /* Masked to a ring rather than filled and covered, so the header's grade
       tint shows through the middle instead of a disc of flat --sheet. */
    -webkit-mask: radial-gradient(farthest-side, #0000 calc(100% - 5px), #000 calc(100% - 4px));
            mask: radial-gradient(farthest-side, #0000 calc(100% - 5px), #000 calc(100% - 4px));
    transition: --dr-dial var(--dur-slow) var(--ease-out);
  }
  .score-ring[data-grade="poor"]      { --dial: var(--grade-poor-text); }
  .score-ring[data-grade="weak"]      { --dial: var(--grade-weak-text); }
  .score-ring[data-grade="fair"]      { --dial: var(--grade-fair-text); }
  .score-ring[data-grade="good"]      { --dial: var(--grade-good-text); }
  .score-ring[data-grade="excellent"] { --dial: var(--grade-excellent-text); }

  .score {
    grid-area: 1 / 1;
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-d3); font-weight: 700; line-height: 1; letter-spacing: -.03em;
    color: var(--text);
  }
  /* Grade is a five-way read of the same 0-100 the rest of the panel keeps to
     three tones (Tone) -- justified here because this is the one number
     shown once, in isolation, at the size that draws the eye first. */
  .score[data-grade="poor"]      { color: var(--grade-poor-text);      font-size: var(--grade-poor-size); }
  .score[data-grade="weak"]      { color: var(--grade-weak-text);      font-size: var(--grade-weak-size); }
  .score[data-grade="fair"]      { color: var(--grade-fair-text);      font-size: var(--grade-fair-size); }
  .score[data-grade="good"]      { color: var(--grade-good-text);      font-size: var(--grade-good-size); }
  .score[data-grade="excellent"] { color: var(--grade-excellent-text); font-size: var(--grade-excellent-size); }

  .score-side { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2); }
  .score-of {
    font-size: var(--fs-xs); letter-spacing: .06em; text-transform: uppercase;
    color: var(--text-faint);
  }
  .score-withheld {
    font-size: var(--fs-md); font-weight: 650; color: var(--tone-caution-text);
  }
  .headline {
    margin: var(--sp-4) 0 0; font-size: var(--fs-base); line-height: 1.55; color: var(--text-muted);
  }

  /* title status, shared by both header states ------------------------ */
  .title-status { margin-top: var(--sp-4); }
  .title-status-message {
    margin: var(--sp-2) 0 0; font-size: var(--fs-sm); line-height: 1.45; color: var(--text-muted);
  }

  /* unreliable -------------------------------------------------------- */
  .verdict {
    margin: var(--sp-4) 0 0;
    font-size: var(--fs-lg); font-weight: 650; line-height: 1.25; letter-spacing: -.015em;
    color: var(--text); text-wrap: balance;
  }
  .problems { list-style: none; margin: var(--sp-4) 0 0; padding: 0; }
  .problems li {
    display: flex; gap: var(--sp-3); align-items: baseline;
    font-size: var(--fs-base); line-height: 1.45; color: var(--text-muted);
    margin-bottom: var(--sp-1);
  }
  .problem-glyph { color: var(--tone-caution-text); flex: none; }
  .meta-row {
    display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--sp-4);
  }

  .score-reveal { margin-top: var(--sp-4); }
  .score-reveal summary {
    font-size: var(--fs-sm); color: var(--text-dim); cursor: pointer;
    padding: 3px 0; border-radius: var(--radius-sm); width: fit-content;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .score-reveal summary:hover { color: var(--text); }
  .score-secondary {
    margin: var(--sp-2) 0 0; font-size: var(--fs-sm); line-height: 1.5; color: var(--text-muted);
  }
  .score-secondary strong { color: var(--text); font-size: var(--fs-md); }

  /* chips and badges -------------------------------------------------- */
  .chip {
    display: inline-flex; align-items: center; gap: var(--sp-1);
    font-size: var(--fs-xs); font-weight: 650;
    padding: 3px var(--sp-3); border-radius: var(--radius-pill);
    border: 1px solid currentColor;
  }
  .chip-glyph { font-size: var(--fs-xs); }
  .chip[data-tone="favorable"] { color: var(--tone-favorable-text); }
  .chip[data-tone="caution"]   { color: var(--tone-caution-text); }
  .chip[data-tone="adverse"]   { color: var(--tone-adverse-text); }
  .chip[data-tone="neutral"]   { color: var(--text-dim); }
  .beta {
    font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .08em;
    background: var(--beta); color: var(--beta-on);
    padding: 3px var(--sp-2); border-radius: var(--radius-sm);
  }
`;
