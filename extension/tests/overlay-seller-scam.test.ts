/**
 * The "seller and scam risk" dropdown (spec 6.3, 7.4).
 *
 * Drives `buildSellerScamRiskDetail` directly rather than through
 * `renderEvaluation`, the same reasoning as `overlay-ai-insights.test.ts`:
 * what is under test is a set of static renders over one field of the
 * response, not the whole panel.
 *
 * The case these exist for is the one that is easiest to get backwards. A null
 * `seller_risk` is the CLEAN listing -- `has_seller_section` in
 * `evaluation/report.py` omits the section when nothing fired, the seller is
 * not a dealer, and no rating has enough reviews to matter -- so it is both the
 * commonest response shape and the one where rendering "no assessment
 * available" would report an ordinary good outcome as a failure.
 */

import { describe, expect, it } from "vitest";

import { buildSellerScamRiskDetail } from "../src/content/overlay/sections";
import type { EvaluationResponse } from "../src/shared/types";

type SellerRisk = NonNullable<EvaluationResponse["seller_risk"]>;

function sellerRisk(overrides: Partial<SellerRisk> = {}): SellerRisk {
  return {
    seller_type: "private",
    dealer_markers: [],
    scam_warning: false,
    scam_signals_fired: [],
    scam_signals_evaluable: 5,
    scam_signals_total: 7,
    scam_reduced_sensitivity: true,
    seller_rating_average: null,
    seller_rating_count: null,
    messages: [],
    ...overrides,
  };
}

function evaluation(
  seller: EvaluationResponse["seller_risk"],
  ownerCount: string | null = null,
): EvaluationResponse {
  return {
    seller_risk: seller,
    vehicle_details: { owner_count: ownerCount },
  } as unknown as EvaluationResponse;
}

/** The rendered dropdown as one string, which is what these assert against. */
function render(
  seller: EvaluationResponse["seller_risk"],
  ownerCount: string | null = null,
): string {
  const host = document.createElement("div");
  host.append(...buildSellerScamRiskDetail(evaluation(seller, ownerCount)));
  return host.textContent ?? "";
}

describe("a clean listing (null seller_risk)", () => {
  it("reports nothing found rather than nothing checked", () => {
    const text = render(null);
    expect(text).toContain("None");
    expect(text).not.toMatch(/no scam-pattern assessment is available/i);
    expect(text).not.toMatch(/unavailable/i);
  });

  it("still carries the coverage caveat, so a clean result is not oversold", () => {
    expect(render(null)).toMatch(/can never be checked yet/i);
  });

  it("summarises as none fired without inventing a denominator", () => {
    const [patterns] = buildSellerScamRiskDetail(evaluation(null));
    const summary = patterns?.querySelector(".disclosure-summary")?.textContent ?? "";
    expect(summary).toBe("none fired");
    expect(summary).not.toMatch(/\d/);
  });
});

describe("fired patterns", () => {
  it("leads with the count over the evaluable total, not the spec's seven", () => {
    const text = render(
      sellerRisk({ scam_signals_fired: ["few_or_stock_photos", "minimal_description"] }),
    );
    expect(text).toContain("2 of 5");
    expect(text).not.toContain("2 of 7");
  });

  it("renders each fired signal as prose rather than its wire code", () => {
    const text = render(sellerRisk({ scam_signals_fired: ["vin_omitted_from_detailed_listing"] }));
    expect(text).toContain("omits the VIN");
    expect(text).not.toContain("vin_omitted_from_detailed_listing");
  });

  it("keeps minimal_description listed, so the count matches its own evidence", () => {
    // The bullet duplicates information completeness's 120-char check and was
    // the reason this section was restructured -- but dropping it while the
    // backend still counts it toward `scam_warning` would print a count with
    // one fewer bullet under it than it claims.
    const seller = sellerRisk({
      scam_signals_fired: ["minimal_description", "few_or_stock_photos"],
    });
    const text = render(seller);
    expect(text).toContain("2 of 5");
    expect(text).toMatch(/minimal or looks templated/i);
  });
});

describe("the warning threshold (spec 6.3)", () => {
  const warned = sellerRisk({
    scam_warning: true,
    scam_signals_fired: [
      "unexplained_deep_discount",
      "few_or_stock_photos",
      "minimal_description",
      "payment_or_meeting_red_flags",
    ],
  });

  it("promotes to a callout rather than a stat tile", () => {
    const [patterns] = buildSellerScamRiskDetail(evaluation(warned));
    expect(patterns?.querySelector(".callout")).not.toBeNull();
    expect(patterns?.querySelector(".stat")).toBeNull();
  });

  it("says why no deal score is shown, and lists all four", () => {
    const text = render(warned);
    expect(text).toContain("4 independent patterns");
    expect(text).toMatch(/no deal score is shown/i);
    expect(text).toMatch(/omits the VIN|far below|templated|rarely ask for/);
  });
});

describe("the seller's rating", () => {
  it("is shown when it is good, not only when it is bad", () => {
    const text = render(sellerRisk({ seller_rating_average: 4.9, seller_rating_count: 22 }));
    expect(text).toContain("4.9/5");
    expect(text).toContain("22 reviews");
  });

  it("marks a low rating adverse and says it caps the score", () => {
    const [, sellerPane] = buildSellerScamRiskDetail(
      evaluation(sellerRisk({ seller_rating_average: 2.4, seller_rating_count: 7 })),
    );
    const tile = sellerPane?.querySelector(".stat");
    expect(tile?.getAttribute("data-tone")).toBe("adverse");
    expect(sellerPane?.textContent).toMatch(/cap this dimension's score/i);
  });

  it("marks a high rating favorable", () => {
    const [, sellerPane] = buildSellerScamRiskDetail(
      evaluation(sellerRisk({ seller_rating_average: 4.6, seller_rating_count: 12 })),
    );
    expect(sellerPane?.querySelector(".stat")?.getAttribute("data-tone")).toBe("favorable");
  });

  it("withholds a rating with too few reviews to matter", () => {
    // Matches `SELLER_RATING_MIN_REVIEWS` in `evaluation/score.py`: below it the
    // backend does not let the rating cap the score, so showing it would imply
    // a weight it does not carry.
    const text = render(sellerRisk({ seller_rating_average: 5, seller_rating_count: 2 }));
    expect(text).not.toContain("5.0/5");
    expect(text).toMatch(/too few to read anything into/i);
  });

  it("says so plainly when there is no rating at all", () => {
    expect(render(sellerRisk())).toMatch(/no Marketplace rating yet/i);
  });
});

describe("owner count", () => {
  it("is reported for multi-owner vehicles", () => {
    expect(render(sellerRisk(), "three_plus")).toMatch(/three or more owners/i);
  });

  it("stays silent for one owner, which is reassurance nobody asked for", () => {
    expect(render(sellerRisk(), "one")).not.toMatch(/owner/i);
  });
});
