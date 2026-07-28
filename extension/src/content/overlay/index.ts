/**
 * The evaluation overlay (spec 7, build step 8).
 *
 * HIERARCHY, NOT OMISSION
 * -----------------------
 * The panel used to be three screens of flat scroll in which a 34px score sat
 * above the caveats that invalidated it. Everything it surfaced then is still
 * reachable now; what changed is that the panel leads with what it is confident
 * about and folds the rest behind a summary line that carries the finding.
 *
 *   always visible   the headline state, the four pricing numbers, and any
 *                    adverse finding (scam combination, branded title)
 *   one click away   everything else, in spec 7's order, each row summarised
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
import {
  alternativesSummary,
  buildAdverseFindings,
  buildAlternatives,
  buildCompQuality,
  buildKnownIssues,
  buildNegotiation,
  buildPricing,
  buildSellerRisk,
  buildVehicleRisk,
  compQualitySummary,
  knownIssuesSummary,
  negotiationSummary,
  sellerRiskSummary,
  vehicleRiskSummary,
} from "./sections";
import { knownIssuesReasonIsShowable, sellerSectionVisible } from "./state";
import { stylesheet } from "./styles";

const HOST_ID = "deal-rater-overlay";

/**
 * Spec 7's liability framing, as one block rather than three stacked greys.
 *
 * The asking-price notice is not here: it moved into the pricing section, where
 * spec 4.5 wants it ("belongs in the UI, not the terms of service"). What is
 * left is the beta signal and the liability line, which are about the tool
 * rather than the car and belong at the end.
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

  // Anything the backend adds beyond the three known notices still renders, so
  // a new notice cannot go missing because this function did not expect it.
  const known = /beta signal|asking prices|informational analysis/i;
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

  // 1. Headline (spec 7.1), in whichever state the evidence supports.
  sheet.append(buildHeader(data, close));

  // The breakdown belongs with the headline (spec 5.2) and is the section
  // closest to it for that reason -- nothing else renders between them.
  // Always open, not a disclosure: spec 5.2 wants it shown "alongside" the
  // score, not one click away from it.
  sheet.append(section("Score breakdown", buildBreakdown(data))!);

  // 2. Pricing (spec 7.2, 5.1's four numbers). Always visible.
  sheet.append(section("Pricing", buildPricing(data))!);
  sheet.append(
    disclosure("Comp quality", compQualitySummary(data), buildCompQuality(data)),
  );

  // Adverse findings, before anything collapsed. Spec 6.3 requires prominence
  // that does not depend on a score weight or on a click.
  const adverse = buildAdverseFindings(data);
  if (adverse.length) {
    const holder = el("section", "findings");
    holder.append(...adverse);
    sheet.append(holder);
  }

  // 3. Vehicle risk (spec 7.3).
  sheet.append(
    disclosure("Vehicle risk", vehicleRiskSummary(data), buildVehicleRisk(data)),
  );

  // 4. Seller and scam risk (spec 7.4) -- only when there is something to say,
  // which for scam patterns means a COMBINATION rather than one weak signal.
  if (sellerSectionVisible(data.seller_risk)) {
    sheet.append(
      disclosure("Seller and scam risk", sellerRiskSummary(data), buildSellerRisk(data)),
    );
  }

  // 5. Negotiation (spec 7.5).
  sheet.append(
    disclosure("Negotiation", negotiationSummary(data), buildNegotiation(data)),
  );

  // 6. Better alternatives (spec 7.6).
  sheet.append(
    disclosure("Better alternatives", alternativesSummary(data), buildAlternatives(data)),
  );

  // 7. What to check on this car (spec 7.7). Absent whenever the reason for its
  // absence is a fact about the deployment rather than about the car.
  if (data.known_issues || knownIssuesReasonIsShowable(data.known_issues_unavailable_code)) {
    sheet.append(
      disclosure(
        "What to check on this car",
        knownIssuesSummary(data),
        buildKnownIssues(data),
      ),
    );
  }

  sheet.append(buildNotices(data));

  backdrop.append(sheet);
  root.append(style, backdrop);
  document.body.append(host);

  // The close button is the way out of an overlay covering somebody else's
  // page, so it is where focus starts.
  root.querySelector<HTMLButtonElement>("button.close")?.focus();
}
