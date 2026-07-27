/**
 * The evaluation overlay (spec 7, build step 8).
 *
 * Renders spec 7's output structure in its order: headline, pricing, vehicle
 * risk, seller risk (only when there is something to say), negotiation,
 * alternatives, and what to check.
 *
 * THREE THINGS THE MARKUP IS NOT ALLOWED TO DROP
 * ----------------------------------------------
 * 1. THE SCORE BREAKDOWN. Spec 5.2: the composite "is a summary of the
 *    separated dimensions... not a replacement for them, and the UI should
 *    ALWAYS show the breakdown alongside it." The bars under the headline are
 *    not decoration; they are the thing that stops one number standing in for
 *    four readings.
 *
 * 2. THE LIABILITY FRAMING. Spec 7: "informational analysis of a listing, not a
 *    purchase recommendation... IN THE UI, not just the terms." It renders from
 *    `notices`, which the backend always populates.
 *
 * 3. THE BETA LABEL. Spec 9: "Until step 1 is done, present output as a beta
 *    signal, not an authoritative rating." Step 1 is the hand-labelled ground
 *    truth set, which does not exist, so `deal_score.beta` is always true and
 *    the badge always renders.
 *
 * Shadow DOM throughout, for the same reason as the trigger button: Facebook's
 * stylesheet and this one must not be able to reach each other.
 */

import type { EvaluationResponse, ScoreComponent } from "../shared/types";

const HOST_ID = "deal-rater-overlay";

const STYLES = `
  :host { all: initial; }
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483646;
    background: rgba(6, 12, 18, 0.55);
    display: flex; justify-content: flex-end;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .sheet {
    width: min(440px, 100vw);
    height: 100%;
    overflow-y: auto;
    background: #10181f;
    color: #e8eef4;
    box-shadow: -4px 0 24px rgba(0,0,0,.4);
  }
  header {
    position: sticky; top: 0;
    background: #10181f;
    padding: 18px 20px 12px;
    border-bottom: 1px solid #24333f;
  }
  .close {
    position: absolute; top: 14px; right: 16px;
    background: none; border: 0; color: #8fa3b4;
    font-size: 22px; line-height: 1; cursor: pointer; padding: 4px;
  }
  .close:hover { color: #e8eef4; }
  .vehicle { font-size: 12px; color: #8fa3b4; letter-spacing: .04em; text-transform: uppercase; }
  .score-row { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; }
  .score { font-size: 34px; font-weight: 700; }
  .score.withheld { font-size: 17px; font-weight: 600; color: #d9b26a; }
  .beta {
    font-size: 10px; font-weight: 700; letter-spacing: .08em;
    background: #d9b26a; color: #10181f;
    padding: 3px 6px; border-radius: 4px;
  }
  .headline { margin-top: 8px; font-size: 13px; line-height: 1.5; color: #c4d3df; }
  section { padding: 16px 20px; border-bottom: 1px solid #1b2831; }
  h2 {
    margin: 0 0 10px; font-size: 11px; font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase; color: #7f95a8;
  }
  .rows { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; font-size: 13px; }
  .rows dt { color: #8fa3b4; }
  .rows dd { margin: 0; font-variant-numeric: tabular-nums; }
  .big { font-size: 17px; font-weight: 600; }
  ul { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.55; color: #c4d3df; }
  li { margin-bottom: 5px; }
  .component { margin-bottom: 8px; font-size: 12px; }
  .component .top { display: flex; justify-content: space-between; color: #a9bccb; }
  .bar { height: 5px; border-radius: 3px; background: #22313d; margin-top: 3px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: #5c9ecf; }
  .component.missing .top { color: #6c8093; font-style: italic; }
  .warn {
    background: #4a1d1d; border: 1px solid #7a2f2f; border-radius: 8px;
    padding: 12px 14px; margin-bottom: 12px;
  }
  .warn h3 { margin: 0 0 6px; font-size: 13px; color: #ffb3b3; }
  .warn p { margin: 0; font-size: 12.5px; line-height: 1.5; color: #f0d2d2; }
  .alt { padding: 9px 0; border-top: 1px solid #1b2831; font-size: 12.5px; line-height: 1.5; }
  .alt:first-of-type { border-top: 0; }
  .alt a { color: #7fb8e8; text-decoration: none; word-break: break-all; }
  .alt a:hover { text-decoration: underline; }
  .muted { color: #7f95a8; font-size: 12px; line-height: 1.5; }
  .notices { padding: 16px 20px 26px; }
  .notices p { margin: 0 0 8px; font-size: 11px; line-height: 1.5; color: #6c8093; }
`;

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "n/a";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** A section with a heading, or nothing at all when there is nothing to say. */
function section(title: string, body: Node[]): HTMLElement | null {
  if (body.length === 0) return null;
  const node = el("section");
  node.append(el("h2", undefined, title), ...body);
  return node;
}

function list(items: string[]): HTMLElement | null {
  if (items.length === 0) return null;
  const ul = el("ul");
  for (const item of items) ul.append(el("li", undefined, item));
  return ul;
}

function rows(pairs: Array<[string, string, boolean?]>): HTMLElement {
  const dl = el("dl", "rows");
  for (const [label, value, big] of pairs) {
    dl.append(el("dt", undefined, label), el("dd", big ? "big" : undefined, value));
  }
  return dl;
}

function componentBar(component: ScoreComponent): HTMLElement {
  const node = el("div", `component${component.value === null ? " missing" : ""}`);
  const top = el("div", "top");
  top.append(
    el("span", undefined, `${component.name.replace(/_/g, " ")} (${component.weight})`),
    el(
      "span",
      undefined,
      component.value === null ? "not assessed" : `${Math.round(component.value)}`,
    ),
  );
  node.append(top);

  if (component.value !== null) {
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = `${Math.max(0, Math.min(100, component.value))}%`;
    bar.append(fill);
    node.append(bar);
  }
  return node;
}

function buildHeader(data: EvaluationResponse, onClose: () => void): HTMLElement {
  const header = el("header");

  const close = el("button", "close", "×") as HTMLButtonElement;
  close.setAttribute("aria-label", "Close evaluation");
  close.addEventListener("click", onClose);

  const scoreRow = el("div", "score-row");
  const { score, beta, suppressed_reason: suppressed } = data.deal_score;
  scoreRow.append(
    score === null
      ? el("div", "score withheld", "Score withheld")
      : el("div", "score", `${Math.round(score)}`),
  );
  // Spec 9: always, until the ground truth set exists.
  if (beta) scoreRow.append(el("span", "beta", "BETA"));

  header.append(close, el("div", "vehicle", data.vehicle), scoreRow);
  header.append(el("p", "headline", suppressed ?? data.headline));
  return header;
}

export function renderEvaluation(data: EvaluationResponse): void {
  document.getElementById(HOST_ID)?.remove();

  const host = el("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const backdrop = el("div", "backdrop");
  const sheet = el("div", "sheet");
  const close = () => host.remove();

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  sheet.append(buildHeader(data, close));

  // Spec 5.2: the breakdown always travels with the number.
  sheet.append(
    section("Score breakdown", [
      ...data.deal_score.components.map(componentBar),
      el(
        "p",
        "muted",
        `${Math.round(data.deal_score.coverage * 100)}% of the scoring dimensions could be assessed.`,
      ),
    ])!,
  );

  const p = data.pricing;
  const pricingRows: Array<[string, string, boolean?]> = [
    ["Current ask", money(p.ask_cents), true],
  ];
  if (p.expected_asking_cents !== null) {
    pricingRows.push([
      "Expected asking",
      `${money(p.asking_interval_low_cents)} – ${money(p.asking_interval_high_cents)}`,
    ]);
  }
  if (p.strong_offer_cents !== null) {
    pricingRows.push(["Strong offer", money(p.strong_offer_cents)]);
    pricingRows.push(["Walk away above", money(p.walk_away_above_cents)]);
  }
  pricingRows.push(["Confidence", p.confidence]);
  pricingRows.push(["Comps used", `${p.comps_included}`]);

  sheet.append(
    section("Pricing", [
      rows(pricingRows),
      ...(p.strong_offer_cents === null
        ? [el("p", "muted", "Offer figures withheld: the expected range is too wide to name one.")]
        : []),
      ...(list(p.confidence_reasons) ? [list(p.confidence_reasons)!] : []),
    ])!,
  );

  const risk = data.vehicle_risk;
  sheet.append(
    section("Vehicle risk", [
      rows([
        ["Title", risk.title_risk],
        ...(risk.decoded_spec ? ([["VIN decode", risk.decoded_spec]] as Array<[string, string]>) : []),
      ]),
      ...(list([risk.title_message, ...risk.messages]) ? [list([risk.title_message, ...risk.messages])!] : []),
    ])!,
  );

  // Spec 7.4: this section exists only when there is something to say.
  if (data.seller_risk) {
    const body: Node[] = [];
    if (data.seller_risk.scam_warning) {
      const warn = el("div", "warn");
      warn.append(
        el("h3", undefined, "Scam pattern warning"),
        el(
          "p",
          undefined,
          `${data.seller_risk.scam_signals_fired.length} independent signals fired together. ` +
            "Any one is weak; this many at once is not.",
        ),
      );
      body.push(warn);
    }
    const messages = list(data.seller_risk.messages);
    if (messages) body.push(messages);
    const node = section("Seller and scam risk", body);
    if (node) sheet.append(node);
  }

  const n = data.negotiation;
  sheet.append(
    section("Negotiation", [
      rows([
        ["Leverage", n.leverage],
        ["Days listed", n.days_listed === null ? "unknown" : `${n.days_listed}`],
        ...(n.suggested_offer_cents !== null
          ? ([["Suggested offer", money(n.suggested_offer_cents), true]] as Array<
              [string, string, boolean]
            >)
          : []),
      ]),
      ...(list(n.leverage_points) ? [list(n.leverage_points)!] : []),
    ])!,
  );

  const altBody: Node[] = [el("p", "muted", data.alternatives.message)];
  for (const alt of data.alternatives.items) {
    const item = el("div", "alt");
    item.append(el("div", undefined, alt.description));
    if (alt.url) {
      const link = el("a") as HTMLAnchorElement;
      link.href = alt.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open listing";
      item.append(link);
    }
    altBody.push(item);
  }
  if (data.alternatives.withheld_as_implausible > 0) {
    altBody.push(
      el(
        "p",
        "muted",
        `${data.alternatives.withheld_as_implausible} cheaper listing(s) withheld: priced far ` +
          "enough below expected that the reason matters more than the saving.",
      ),
    );
  }
  sheet.append(section("Better alternatives", altBody)!);

  // Spec 7 item 7 / spec 6.6. Absent more often than present -- no API key,
  // spec 10's cost gate, or a failed call -- so the reason is rendered in its
  // place rather than an empty heading, and it explains itself.
  const known = data.known_issues;
  const knownBody: Node[] = [];
  if (known) {
    knownBody.push(el("p", undefined, known.summary));
    // Any of these may legitimately be empty: plenty of cars have no
    // documented widespread problem in a mileage range, and `list` returns
    // null rather than an empty heading.
    const groups: Array<[string, string[]]> = [
      ["Known to go wrong", known.failure_modes],
      ["Check on the viewing", known.inspect],
      ["Ask the seller", known.ask],
      ["Living with it", known.ownership_notes],
    ];
    for (const [label, items] of groups) {
      const ul = list(items);
      if (!ul) continue;
      knownBody.push(el("p", "muted", label), ul);
    }
    if (
      !known.failure_modes.length &&
      !known.inspect.length &&
      !known.ask.length &&
      !known.ownership_notes.length
    ) {
      knownBody.push(
        el("p", "muted", "No widespread model-specific problems documented for this mileage."),
      );
    }
  } else if (data.known_issues_unavailable_reason) {
    knownBody.push(el("p", "muted", data.known_issues_unavailable_reason));
  }
  const knownSection = section("What to check on this car", knownBody);
  if (knownSection) sheet.append(knownSection);

  // Spec 7's liability framing, in the UI rather than only the terms.
  const notices = el("div", "notices");
  for (const notice of data.notices) notices.append(el("p", undefined, notice));
  sheet.append(notices);

  backdrop.append(sheet);
  root.append(style, backdrop);
  document.body.append(host);
}
