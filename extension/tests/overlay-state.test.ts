/**
 * The panel's presentation decisions (spec 5.2, 6.2, 6.3, 6.6, 7).
 *
 * These are the judgements that used to be inline ternaries in the render pass,
 * where nothing could reach them. Each claim under test corresponds to a way the
 * old panel contradicted itself or the evaluation it was displaying.
 */

import { describe, expect, it } from "vitest";

import {
  breakdownIsFlat,
  compProblems,
  confidenceTone,
  contributions,
  headlineState,
  intervalWidthRatio,
  knownIssuesReasonIsShowable,
  priceComparison,
  scoreGrade,
  scoreTone,
} from "../src/content/overlay/state";
import { breakdownSummary } from "../src/content/overlay/breakdown";
import type { EvaluationResponse, ScoreComponent } from "../src/shared/types";

function pricing(over: Partial<EvaluationResponse["pricing"]> = {}) {
  return {
    ask_cents: 1_260_000,
    expected_asking_cents: 1_200_000,
    asking_interval_low_cents: 1_150_000,
    asking_interval_high_cents: 1_250_000,
    interval_coverage: 0.8,
    strong_offer_cents: 1_100_000,
    walk_away_above_cents: 1_240_000,
    residual_fraction: 0.05,
    rating: 60,
    rating_band: "plateau",
    rating_calibrated: false,
    estimator: "mileage_regression",
    comps_included: 22,
    comps_with_mileage: 20,
    year_window: 1,
    year_window_widened: false,
    confidence: "high",
    confidence_reasons: [],
    confidence_limiters: [],
    fallback_reasons: [],
    ...over,
  } as EvaluationResponse["pricing"];
}

function evaluation(over: Partial<EvaluationResponse> = {}): EvaluationResponse {
  return {
    capture_id: 1,
    headline: "",
    vehicle: "2016 Mazda CX-5",
    deal_score: { score: 70, components: [], coverage: 1, suppressed_reason: null, beta: true },
    pricing: pricing(),
    vehicle_details: {
      year: 2016,
      make: "Mazda",
      model: "CX-5",
      mileage: 45_000,
      title_status: "Clean",
    },
    vehicle_risk: {
      title_risk: "clean",
      title_message: "",
      decoded_spec: null,
      recall_count: null,
      complaint_count: null,
      top_complaint_components: [],
      recall_messages: [],
      complaint_messages: [],
    },
    seller_risk: null,
    negotiation: {
      leverage: "unknown",
      strength: 50,
      days_listed: null,
      time_on_market_score: null,
      leverage_points: [],
      suggested_offer_cents: null,
      motivated_phrases: [],
      rigid_phrases: [],
    },
    alternatives: { message: "", target_is_best: false, items: [], withheld: [] },
    known_issues: null,
    known_issues_unavailable_reason: null,
    known_issues_unavailable_code: null,
    notices: [],
    ...over,
  } as EvaluationResponse;
}

function component(
  name: string,
  weight: number,
  value: number | null,
): ScoreComponent {
  return { name, weight, value, unavailable_reason: value === null ? "no data" : null };
}

describe("headline state", () => {
  it("leads with the score when the comps support one", () => {
    expect(headlineState(evaluation())).toBe("confident");
  });

  it("refuses the big number on low confidence", () => {
    expect(headlineState(evaluation({ pricing: pricing({ confidence: "low" }) }))).toBe(
      "unreliable",
    );
  });

  it("does not re-flag a wide interval the backend already weighed into MEDIUM", () => {
    // An earlier version escalated to "unreliable" on interval width alone,
    // regardless of confidence. Wide intervals are already an input to the
    // backend's confidence roll-up (same 35%-of-midpoint threshold, see
    // `pricing/confidence.py`'s WIDE_INTERVAL limiter), so re-deriving the
    // same signal here meant a listing MEDIUM specifically because the
    // backend weighed a wide interval and still called it MEDIUM would get
    // second-guessed straight back to "unreliable". Measured against ~150
    // real captures that fired on nearly every MEDIUM-confidence listing.
    const wide = pricing({
      confidence: "medium",
      asking_interval_low_cents: 910_000,
      asking_interval_high_cents: 1_540_000,
    });
    expect(intervalWidthRatio(wide)!).toBeCloseTo(0.514, 2);
    expect(headlineState(evaluation({ pricing: wide }))).toBe("confident");
  });

  it("treats a missing interval as no evidence either way", () => {
    const none = pricing({
      asking_interval_low_cents: null,
      asking_interval_high_cents: null,
      confidence: "medium",
    });
    expect(intervalWidthRatio(none)).toBeNull();
    expect(headlineState(evaluation({ pricing: none }))).toBe("confident");
  });
});

describe("comp problems", () => {
  const limiters = [
    "no_recency_weighting",
    "dealer_filtering_unavailable",
    "comp_count",
    "trim_disagreement",
  ];

  it("ranks by what a limiter means, not by the order it was appended", () => {
    // The wire order puts the two structural limiters first, and they fire on
    // every evaluation this tool will ever run.
    const problems = compProblems(pricing({ confidence_limiters: limiters, comps_included: 4 }), 2);
    expect(problems[0]).toContain("different trim");
    expect(problems[1]).toContain("only 4 comparable listings");
  });

  it("interpolates the actual comp count rather than saying 'few'", () => {
    const problems = compProblems(
      pricing({ confidence_limiters: ["comp_count"], comps_included: 1 }),
      1,
    );
    expect(problems[0]).toBe("only 1 comparable listing was usable");
  });
});

describe("score breakdown", () => {
  const components = [
    component("price_residual", 56, 40),
    component("information_completeness", 9, 90),
    component("vehicle_risk", 25, 85),
    component("seller_and_scam_risk", 10, 100),
  ];

  it("orders by contribution, so a 9-point dimension cannot outrank a 56-point one", () => {
    const order = contributions(components).map((c) => c.component.name);
    expect(order[0]).toBe("price_residual");
    expect(order.indexOf("vehicle_risk")).toBeLessThan(
      order.indexOf("information_completeness"),
    );
  });

  it("makes the contributions sum to the score", () => {
    const total = contributions(components).reduce((sum, c) => sum + (c.points ?? 0), 0);
    // The same weighted mean `compute_deal_score` publishes.
    const expected = (56 * 40 + 9 * 90 + 25 * 85 + 10 * 100) / 100;
    expect(total).toBeCloseTo(expected, 6);
  });

  it("renormalises over what could be assessed, and says so in the row", () => {
    const missing = [
      component("price_residual", 56, 40),
      component("information_completeness", 9, 90),
      component("vehicle_risk", 25, null),
      component("seller_and_scam_risk", 10, 100),
    ];
    const rows = contributions(missing);
    const price = rows.find((r) => r.component.name === "price_residual")!;
    // 56 of the 75 points that were actually available, not 56 of 100.
    expect(price.maxPoints).toBeCloseTo((56 / 75) * 100, 6);
    expect(price.points).toBeCloseTo(((56 / 75) * 100 * 40) / 100, 6);
    expect(rows.at(-1)!.component.name).toBe("vehicle_risk");
  });

  it("names the dimension that gave away the most points, not the lowest score", () => {
    // Completeness scores lower, but it is 9% of the number; price residual is
    // what actually moved the headline.
    const summary = breakdownSummary(
      evaluation({
        deal_score: {
          score: 55,
          components: [
            component("price_residual", 56, 45),
            component("information_completeness", 9, 20),
            component("vehicle_risk", 25, 85),
            component("seller_and_scam_risk", 10, 100),
          ],
          coverage: 1,
          suppressed_reason: null,
          beta: true,
        },
      }),
    );
    expect(summary).toContain("price residual");
  });

  it("calls a flat breakdown flat instead of drawing four identical bars", () => {
    const flat = [
      component("price_residual", 56, 64),
      component("information_completeness", 9, 70),
      component("vehicle_risk", 25, 68),
      component("seller_and_scam_risk", 10, 62),
    ];
    expect(breakdownIsFlat(flat)).toBe(true);
    expect(breakdownIsFlat(components)).toBe(false);
  });

  it("has nothing to say when the breakdown is flat, rather than describing the chart under it", () => {
    const summary = breakdownSummary(
      evaluation({
        deal_score: {
          score: 66,
          components: [
            component("price_residual", 56, 64),
            component("information_completeness", 9, 70),
            component("vehicle_risk", 25, 68),
            component("seller_and_scam_risk", 10, 62),
          ],
          coverage: 1,
          suppressed_reason: null,
          beta: true,
        },
      }),
    );
    expect(summary).toBe("");
  });
});

describe("semantic tone", () => {
  it("maps confidence and sub-scores onto the same three states", () => {
    expect(confidenceTone("high")).toBe("favorable");
    expect(confidenceTone("medium")).toBe("caution");
    expect(confidenceTone("low")).toBe("adverse");
    expect(scoreTone(90)).toBe("favorable");
    expect(scoreTone(50)).toBe("caution");
    expect(scoreTone(10)).toBe("adverse");
    expect(scoreTone(null)).toBe("neutral");
  });

  it("grades the headline score into five bands, boundaries inclusive on the upper end", () => {
    expect(scoreGrade(0)).toBe("poor");
    expect(scoreGrade(54.9)).toBe("poor");
    expect(scoreGrade(55)).toBe("weak");
    expect(scoreGrade(64.9)).toBe("weak");
    expect(scoreGrade(65)).toBe("fair");
    expect(scoreGrade(74.9)).toBe("fair");
    expect(scoreGrade(75)).toBe("good");
    expect(scoreGrade(84.9)).toBe("good");
    expect(scoreGrade(85)).toBe("excellent");
    expect(scoreGrade(100)).toBe("excellent");
  });
});

describe("known issues (spec 6.6, 10)", () => {
  it("hides the section when the reason is a fact about the deployment", () => {
    expect(knownIssuesReasonIsShowable("deployment_not_configured")).toBe(false);
    expect(knownIssuesReasonIsShowable("deployment_disabled")).toBe(false);
    expect(knownIssuesReasonIsShowable(null)).toBe(false);
  });

  it("shows the gate's verdicts, which are findings about the car", () => {
    expect(knownIssuesReasonIsShowable("title_disqualifier")).toBe(true);
    expect(knownIssuesReasonIsShowable("pricing_disqualifier")).toBe(true);
    expect(knownIssuesReasonIsShowable("insufficient_vehicle_data")).toBe(true);
  });
});

describe("price comparison", () => {
  it("states the comparison without restating the score", () => {
    expect(priceComparison(pricing())).toBe(
      "22 comparable listings suggest $11,500–$12,500. This asks $12,600.",
    );
  });

  it("defers to the backend sentence when there is no estimate", () => {
    expect(
      priceComparison(
        pricing({ asking_interval_low_cents: null, asking_interval_high_cents: null }),
      ),
    ).toBeNull();
  });
});
