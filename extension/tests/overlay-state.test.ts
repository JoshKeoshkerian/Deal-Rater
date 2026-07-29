/**
 * The panel's presentation decisions (spec 5.2, 6.2, 6.3, 6.6, 7).
 *
 * These are the judgements that used to be inline ternaries in the render pass,
 * where nothing could reach them. Each claim under test corresponds to a way the
 * old panel contradicted itself or the evaluation it was displaying.
 */

import { describe, expect, it } from "vitest";

import {
  alternativeVehicle,
  breakdownIsFlat,
  compProblems,
  confidenceTone,
  contributions,
  headlineState,
  intervalWidthRatio,
  knownIssuesReasonIsShowable,
  offerLadder,
  offerStanceChip,
  priceComparison,
  priceDelta,
  priceGauge,
  scoreGrade,
  scoreTone,
  timeOnMarketTrack,
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
    completeness: { present: [], missing: [] },
    vehicle_details: {
      year: 2016,
      make: "Mazda",
      model: "CX-5",
      mileage: 45_000,
      title_status: "Clean",
      seller_type: "private_party",
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
      offer: {
        stance: "withheld",
        basis: "none",
        opening_cents: null,
        target_cents: null,
        walk_away_cents: null,
        reasoning: [],
        caveat: null,
        withheld_reason: "This listing has no asking price.",
      },
      opening_message: null,
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

  it("always orders price, vehicle risk, seller/scam risk, then completeness", () => {
    const order = contributions(components).map((c) => c.component.name);
    expect(order).toEqual([
      "price_residual",
      "vehicle_risk",
      "seller_and_scam_risk",
      "information_completeness",
    ]);
  });

  it("keeps that order even when a low-weight dimension outscores a high-weight one", () => {
    // Completeness (9%) scores 100 and price residual (56%) scores 10 -- by
    // contribution, completeness would win. The row order must not care.
    const reordered = [
      component("price_residual", 56, 10),
      component("information_completeness", 9, 100),
      component("vehicle_risk", 25, 85),
      component("seller_and_scam_risk", 10, 100),
    ];
    const order = contributions(reordered).map((c) => c.component.name);
    expect(order).toEqual([
      "price_residual",
      "vehicle_risk",
      "seller_and_scam_risk",
      "information_completeness",
    ]);
  });

  it("keeps the fixed order even when a dimension could not be assessed", () => {
    const missing = [
      component("price_residual", 56, 40),
      component("information_completeness", 9, 90),
      component("vehicle_risk", 25, null),
      component("seller_and_scam_risk", 10, 100),
    ];
    const order = contributions(missing).map((c) => c.component.name);
    expect(order).toEqual([
      "price_residual",
      "vehicle_risk",
      "seller_and_scam_risk",
      "information_completeness",
    ]);
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
    // Unassessed, but the row order is fixed regardless -- it stays in its
    // usual second slot rather than sinking to the bottom.
    expect(rows.find((r) => r.component.name === "vehicle_risk")!.points).toBeNull();
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

describe("price gauge (spec 5.1)", () => {
  // Spec 5.1's own example, so the arithmetic below can be checked against the
  // spec rather than against this test.
  const spec = pricing({
    ask_cents: 1_490_000,
    asking_interval_low_cents: 1_380_000,
    asking_interval_high_cents: 1_430_000,
    strong_offer_cents: 1_320_000,
    walk_away_above_cents: 1_460_000,
  });

  it("puts all four figures on one scale, in spec order", () => {
    const gauge = priceGauge(spec)!;
    expect(gauge).not.toBeNull();
    // strong offer < interval < walk away < ask, which is the reading the
    // graphic exists to make obvious.
    expect(gauge.strongOffer!).toBeLessThan(gauge.band!.start);
    expect(gauge.band!.start).toBeLessThan(gauge.band!.end);
    expect(gauge.band!.end).toBeLessThan(gauge.walkAway!);
    expect(gauge.walkAway!).toBeLessThan(gauge.ask!);
  });

  it("keeps every mark inside the track", () => {
    const gauge = priceGauge(spec)!;
    for (const position of [gauge.ask, gauge.strongOffer, gauge.walkAway, gauge.band!.start, gauge.band!.end]) {
      expect(position!).toBeGreaterThan(0);
      expect(position!).toBeLessThan(1);
    }
  });

  it("reads an ask above the walk-away threshold as adverse", () => {
    expect(priceGauge(spec)!.askTone).toBe("adverse");
  });

  it("reads an ask over the interval but under walk-away as caution", () => {
    expect(priceGauge(pricing({ ...spec, ask_cents: 1_445_000 }))!.askTone).toBe("caution");
  });

  it("reads an ask inside the interval as no judgement at all", () => {
    expect(priceGauge(pricing({ ...spec, ask_cents: 1_400_000 }))!.askTone).toBe("neutral");
  });

  it("reads an ask below the interval as favorable", () => {
    expect(priceGauge(pricing({ ...spec, ask_cents: 1_300_000 }))!.askTone).toBe("favorable");
  });

  it("draws nothing without an interval to anchor it", () => {
    // A number line with one point on it is a decoration, not a reading.
    expect(
      priceGauge(pricing({ asking_interval_low_cents: null, asking_interval_high_cents: null })),
    ).toBeNull();
  });

  it("survives a degenerate span rather than dividing by zero", () => {
    const flat = priceGauge(
      pricing({
        ask_cents: 1_000_000,
        asking_interval_low_cents: 1_000_000,
        asking_interval_high_cents: 1_000_000,
        strong_offer_cents: null,
        walk_away_above_cents: null,
      }),
    )!;
    expect(Number.isFinite(flat.ask!)).toBe(true);
    expect(Number.isFinite(flat.band!.start)).toBe(true);
  });

  it("omits the figures the backend did not publish", () => {
    const gauge = priceGauge(
      pricing({ strong_offer_cents: null, walk_away_above_cents: null }),
    )!;
    expect(gauge.strongOffer).toBeNull();
    expect(gauge.walkAway).toBeNull();
    expect(gauge.band).not.toBeNull();
  });
});

describe("price delta on an alternative", () => {
  it("names the saving and reads it as favorable", () => {
    expect(priceDelta(1_320_000, 1_490_000)).toEqual({ text: "$1,700 less", tone: "favorable" });
  });

  it("names the premium and reads it as caution", () => {
    expect(priceDelta(1_520_000, 1_490_000)).toEqual({ text: "$300 more", tone: "caution" });
  });

  it("says so rather than printing $0", () => {
    expect(priceDelta(1_490_000, 1_490_000)).toEqual({ text: "same price", tone: "neutral" });
  });

  it("declines to compare against a missing price", () => {
    expect(priceDelta(1_320_000, null)).toBeNull();
    expect(priceDelta(null, 1_490_000)).toBeNull();
  });
});

describe("alternative vehicle name", () => {
  it("takes the vehicle and leaves the fields the card renders itself", () => {
    expect(
      alternativeVehicle(
        "2016 Mazda CX-5 - $13,200, 71,400 mi, Kirkwood, MO  [better value by 12% of expected price]",
      ),
    ).toBe("2016 Mazda CX-5");
  });

  it("keeps the whole line when there is no separator to split on", () => {
    // A slightly long heading still says what the car is; an empty one does not.
    expect(alternativeVehicle("2016 Mazda CX5")).toBe("2016 Mazda CX5");
  });
});

/* -------------------------------------------------------------------------- */
/* negotiation (spec 6.4, 7.5)                                                */
/* -------------------------------------------------------------------------- */

function negotiation(
  over: Partial<EvaluationResponse["negotiation"]> = {},
): EvaluationResponse["negotiation"] {
  return {
    leverage: "strong",
    strength: 78,
    days_listed: 38,
    time_on_market_score: 80,
    leverage_points: [],
    offer: {
      stance: "negotiate",
      basis: "comps",
      opening_cents: 1_310_000,
      target_cents: 1_380_000,
      walk_away_cents: 1_460_000,
      reasoning: [],
      caveat: null,
      withheld_reason: null,
    },
    opening_message: null,
    motivated_phrases: [],
    rigid_phrases: [],
    ...over,
  };
}

describe("offer ladder (spec 7.5)", () => {
  it("puts the three figures in ascending order with the opening leading", () => {
    const steps = offerLadder(negotiation())!;
    expect(steps.map((s) => s.cents)).toEqual([1_310_000, 1_380_000, 1_460_000]);
    expect(steps[0]!.lead).toBe(true);
    expect(steps.slice(1).every((s) => !s.lead)).toBe(true);
  });

  it("collapses to one figure when opening and target are the same", () => {
    // The backend does this on a listing already asking below what the comps
    // support. "Open at $12,450 / Expect to pay $12,450" reads as a bug rather
    // than as the finding that there is nothing to argue down.
    const steps = offerLadder(
      negotiation({
        offer: {
          stance: "pay_near_asking",
          basis: "comps",
          opening_cents: 1_245_000,
          target_cents: 1_245_000,
          walk_away_cents: 1_736_000,
          reasoning: [],
          caveat: null,
          withheld_reason: null,
        },
      }),
    )!;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.label).toBe("Offer their ask");
    expect(steps[1]!.label).toBe("Walk away above");
  });

  it("omits the walk-away step when the backend did not publish one", () => {
    // An ask-anchored plan has no value estimate under it, so it names no
    // ceiling. A ladder that invented one would be the panel making a claim.
    const steps = offerLadder(
      negotiation({
        offer: {
          stance: "negotiate",
          basis: "ask",
          opening_cents: 1_310_000,
          target_cents: 1_380_000,
          walk_away_cents: null,
          reasoning: [],
          caveat: null,
          withheld_reason: null,
        },
      }),
    )!;
    expect(steps).toHaveLength(2);
    expect(steps.some((s) => s.label === "Walk away above")).toBe(false);
  });

  it("draws nothing when there is no figure at all", () => {
    expect(
      offerLadder(
        negotiation({
          offer: {
            stance: "withheld",
            basis: "none",
            opening_cents: null,
            target_cents: null,
            walk_away_cents: null,
            reasoning: [],
            caveat: null,
            withheld_reason: "No asking price.",
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("offer stance", () => {
  it("names each stance as a chip a reader can act on", () => {
    expect(offerStanceChip("negotiate")?.tone).toBe("favorable");
    expect(offerStanceChip("pay_near_asking")?.tone).toBe("caution");
    expect(offerStanceChip("stretch")?.tone).toBe("adverse");
    expect(offerStanceChip("withheld")).toBeNull();
  });

  // The caveat text is deliberately NOT built here any more. The panel used to
  // compose its own version of a qualification the backend also put in
  // `reasoning`, so the same hedge rendered twice; `offer.caveat` is now the only
  // place the sentence exists, and the panel renders it verbatim at the bottom of
  // the section.
});

describe("time on market track", () => {
  it("marks the 14, 30 and 75 day thresholds so the dot interprets itself", () => {
    const track = timeOnMarketTrack(38)!;
    expect(track.marks.map((m) => m.label)).toEqual(["14d", "30d", "75d"]);
    expect(track.position).toBeGreaterThan(0);
    expect(track.position).toBeLessThan(1);
  });

  it("grows the axis for a listing that has outrun it", () => {
    // A 200-day car pinned to a 90-day axis reads the same as a 90-day one.
    const long = timeOnMarketTrack(200)!;
    expect(long.position).toBeLessThan(1);
    expect(long.marks[2]!.position).toBeLessThan(0.5);
  });

  it("reads a stale listing and a fresh one differently in words", () => {
    expect(timeOnMarketTrack(0)!.phase).toContain("just listed");
    expect(timeOnMarketTrack(90)!.phase).toContain("months");
  });

  it("draws nothing without a posted date", () => {
    // Absence of evidence. A marker at zero would render it as posted today,
    // which is the opposite reading.
    expect(timeOnMarketTrack(null)).toBeNull();
  });
});
