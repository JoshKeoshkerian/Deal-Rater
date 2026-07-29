/**
 * The evaluation overlay.
 *
 * VERTICAL ORDER
 * ---------------
 * Headline -> score breakdown -> Pricing/Details -> Risk (red flags, recalls,
 * known issues -- combining what used to be three separate panels) ->
 * Questions to ask the seller -> Negotiation -> Better alternatives.
 *
 * Score breakdown, Pricing/Details and Risk are always open: a buyer weighing
 * risk should not have to click to see it. Negotiation and Better alternatives
 * stay one click away, each with a summary line that carries the finding, so a
 * user who never expands them has still been told the headline of what's
 * inside.
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
import { aiBadge, disclosure, el, section } from "./elements";
import { buildHeader } from "./headline";
import {
  alternativesSummary,
  buildAlternatives,
  buildNegotiation,
  buildPricing,
  buildQuestions,
  buildRisk,
  negotiationSummary,
} from "./sections";
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
  // score, not one click away from it.
  sheet.append(section("Score breakdown", buildBreakdown(data))!);

  // 2. Pricing/Details: spec 5.1's numbers plus the listing's own stated
  // facts (year, make, model, mileage, title status). Always visible.
  sheet.append(section("Pricing/Details", buildPricing(data))!);

  // 3. Risk: red flags about the listing, open recalls, and what's known to
  // go wrong with the car -- one section where three used to be. The AI pill
  // marks it because its "Known issues" subsection leans on the cached model
  // read (spec 6.6); red flags and recalls are deterministic.
  sheet.append(section("Risk", buildRisk(data), aiBadge())!);

  // 4. Questions to ask the seller: spec 6.6's "ask" bullets, promoted out of
  // the risk read into their own section since they're about the
  // conversation with the seller, not the car itself. Hidden entirely when
  // there is nothing to show (`buildQuestions` returns `[]` only for a
  // deployment-side absence -- see `knownIssuesReasonIsShowable`).
  const questions = section("Questions to ask the seller", buildQuestions(data), aiBadge());
  if (questions) sheet.append(questions);

  // 5. Negotiation.
  sheet.append(
    disclosure("Negotiation", negotiationSummary(data), buildNegotiation(data)),
  );

  // 6. Better alternatives.
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
