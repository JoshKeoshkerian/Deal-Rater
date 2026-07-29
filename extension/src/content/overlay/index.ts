/**
 * The evaluation overlay.
 *
 * EXPERIMENT: SCORE BREAKDOWN AS THE STAR OF THE SHOW
 * -----------------------------------------------------
 * Pricing, Risk and Questions to ask the seller no longer have their own
 * top-level sections. Each of the score breakdown's four dimension bars is
 * now its own dropdown, and expanding one reveals everything that dimension
 * is made of -- see `breakdown.ts`'s `componentDetail`:
 *
 *   price residual          -> Pricing (spec 5.1's numbers)
 *   information completeness -> which fields the seller stated vs. left out
 *   vehicle risk             -> recalls + the model's known-issues read
 *   seller and scam risk     -> red flags (incl. title status) + questions
 *
 * VERTICAL ORDER
 * ---------------
 * Headline -> score breakdown -> Negotiation -> Better alternatives. The
 * latter two are not deal-score dimensions (spec 6.4 keeps negotiation
 * strength out of the composite on purpose), so they stay their own
 * disclosures rather than living under a bar that doesn't exist for them.
 *
 * THREE THINGS THE MARKUP IS NOT ALLOWED TO DROP
 * ----------------------------------------------
 * 1. THE SCORE BREAKDOWN. Spec 5.2: the composite "is a summary of the
 *    separated dimensions... not a replacement for them, and the UI should
 *    ALWAYS show the breakdown alongside it."
 *
 * 2. THE LIABILITY FRAMING. Spec 7: "informational analysis of a listing, not a
 *    purchase recommendation... IN THE UI, not just the terms."
 *
 * 3. THE BETA LABEL. Spec 9: "Until step 1 is done, present output as a beta
 *    signal, not an authoritative rating." `deal_score.beta` is always true.
 *
 * Shadow DOM throughout, for the same reason as the trigger button: Facebook's
 * stylesheet and this one must not be able to reach each other.
 */

import type { EvaluationResponse } from "../../shared/types";
import { buildBreakdown } from "./breakdown";
import { disclosure, el, section } from "./elements";
import { buildHeader } from "./headline";
import { alternativesSummary, buildAlternatives, buildNegotiation, negotiationSummary } from "./sections";
import { stylesheet } from "./styles";

const HOST_ID = "deal-rater-overlay";

/**
 * Spec 7's liability framing, plus spec 4.5's asking-vs-sale-price notice,
 * as one block rather than three stacked greys.
 */
function buildNotices(data: EvaluationResponse): HTMLElement {
  const node = el("div", "notices");
  const body = el("p");
  body.append(
    el("strong", undefined, "Beta signal, not a rating. "),
    el(
      "span",
      undefined,
      "The weights and the discount curve are starting hypotheses that have not been " +
        "checked against hand-evaluated listings yet. This is an informational analysis of " +
        "one listing, not a purchase recommendation, and never a substitute for a " +
        "pre-purchase inspection or a vehicle history report.",
    ),
  );
  node.append(body);

  // Spec 4.5's asking-vs-sale-price distinction used to live inline in the
  // pricing section; that section is now trimmed to its four figures, so this
  // is the only place left to say it -- it must not go missing.
  const known = /beta signal|informational analysis/i;
  for (const notice of data.notices) {
    if (!known.test(notice)) node.append(el("p", undefined, notice));
  }
  return node;
}

export function renderEvaluation(data: EvaluationResponse): void {
  document.getElementById(HOST_ID)?.remove();

  const host = el("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = stylesheet();

  const backdrop = el("div", "backdrop");
  const sheet = el("div", "sheet");
  const close = () => host.remove();

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  // 1. Headline, in whichever state the evidence supports.
  sheet.append(buildHeader(data, close));

  // The breakdown belongs with the headline (spec 5.2) and is the section
  // closest to it for that reason -- nothing else renders between them.
  // Always open, not a disclosure: spec 5.2 wants it shown "alongside" the
  // score, not one click away from it. Pricing, Risk and Questions to ask the
  // seller now live inside its four bars -- see the module docstring.
  sheet.append(section("Score breakdown", buildBreakdown(data))!);

  // 2. Negotiation.
  sheet.append(
    disclosure("Negotiation", negotiationSummary(data), buildNegotiation(data)),
  );

  // 3. Better alternatives.
  sheet.append(
    disclosure("Better alternatives", alternativesSummary(data), buildAlternatives(data)),
  );

  sheet.append(buildNotices(data));

  backdrop.append(sheet);
  root.append(style, backdrop);
  document.body.append(host);

  // The close button is the way out of an overlay covering somebody else's
  // page, so it is where focus starts.
  root.querySelector<HTMLButtonElement>("button.close")?.focus();
}
