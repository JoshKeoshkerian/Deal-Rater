/**
 * Evaluation payloads for the panel preview.
 *
 * Shaped like real responses rather than minimal ones, because the panel's
 * decisions are all about which findings are present: a fixture with no recalls
 * and no scam signals cannot show you what the panel does with either.
 *
 * The figures are taken from captured evaluations where possible -- the
 * unreliable one is capture 3's situation (four usable comps, trim unknown,
 * interval half its own midpoint).
 */

const COMPONENTS = (price, completeness, vehicle, scam) => [
  { name: "price_residual", weight: 56, value: price, unavailable_reason: null },
  {
    name: "information_completeness",
    weight: 9,
    value: completeness,
    unavailable_reason: null,
  },
  {
    name: "vehicle_risk",
    weight: 25,
    value: vehicle,
    unavailable_reason:
      vehicle === null ? "no title status stated and no NHTSA data for this vehicle" : null,
  },
  {
    name: "seller_and_scam_risk",
    weight: 10,
    value: scam,
    unavailable_reason:
      scam === null ? "none of the scam signals could be checked for this listing" : null,
  },
];

function base() {
  return {
    capture_id: 1,
    headline: "",
    vehicle: "2016 Mazda CX-5 Touring",
    deal_score: { score: null, components: [], coverage: 1, suppressed_reason: null, beta: true },
    pricing: {
      ask_cents: null,
      expected_asking_cents: null,
      asking_interval_low_cents: null,
      asking_interval_high_cents: null,
      interval_coverage: 0.8,
      strong_offer_cents: null,
      walk_away_above_cents: null,
      residual_fraction: null,
      rating: null,
      rating_band: null,
      rating_calibrated: false,
      estimator: "mileage_regression",
      comps_included: 0,
      comps_with_mileage: 0,
      year_window: 1,
      year_window_widened: false,
      confidence: "medium",
      confidence_reasons: [],
      confidence_limiters: [],
      fallback_reasons: [],
    },
    vehicle_risk: {
      title_risk: "unstated",
      title_message: "No title status stated. Most listings do not say, so this is not a flag.",
      decoded_spec: null,
      recall_count: null,
      complaint_count: null,
      top_complaint_components: [],
      recall_messages: [],
      complaint_messages: [],
    },
    completeness: { present: [], missing: [] },
    vehicle_details: {
      year: 2016,
      make: "Mazda",
      model: "CX-5",
      mileage: 92_000,
      title_status: null,
      seller_type: null,
      owner_count: null,
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
    alternatives: { message: "", target_is_best: false, items: [], withheld: [], different_trim: [] },
    known_issues: null,
    known_issues_unavailable_reason: null,
    known_issues_unavailable_code: null,
    known_issues_pending: false,
    helpful_links: [
      {
        label: "Kelley Blue Book",
        url: "https://www.kbb.com/mazda/cx-5/2016/",
        note: "Independent pricing reference. KBB still needs your mileage, ZIP code and " +
          "condition to produce a value -- this link only gets you to the right page, not a figure.",
      },
      {
        label: "Consumer Reports",
        url: "https://www.consumerreports.org/cars/mazda/cx-5/2016/overview/",
        note: "Reliability history and owner satisfaction for this model. Consumer Reports " +
          "paywalls most of the detail, but the overview is visible without a subscription.",
      },
    ],
    notices: [
      "Beta signal, not an authoritative rating. The scoring weights and the discount curve " +
        "are starting hypotheses that have not been checked against hand-evaluated listings yet.",
      "Marketplace shows asking prices, not sale prices. Every figure here describes how " +
        "comparable vehicles are ADVERTISED, not what they sell for.",
      "Informational analysis of a listing, not a purchase recommendation. Never a substitute " +
        "for a pre-purchase inspection or a vehicle history report.",
    ],
  };
}

const STRUCTURAL = ["no_recency_weighting", "dealer_filtering_unavailable"];
const STRUCTURAL_TEXT = [
  "Comparable listings carry no posted date, so a long-stale ask counts as much as a fresh one.",
  "Dealer listings could not be filtered out of the comparison set, so retail pricing may be " +
    "inflating the expected asking price.",
];

export const CONFIDENT = {
  ...base(),
  completeness: {
    present: ["price", "mileage", "year", "make", "model", "photos", "description", "title status"],
    missing: ["VIN"],
  },
  vehicle_details: {
    ...base().vehicle_details,
    mileage: 92_000,
    title_status: "clean",
    seller_type: "private_party",
    owner_count: "one",
  },
  headline:
    "74 / 100, high confidence. Comparable listings suggest an expected asking range of " +
    "$13,800 to $14,300. This asks $14,900.",
  deal_score: {
    score: 74,
    components: COMPONENTS(64, 88, 82, 100),
    coverage: 1,
    suppressed_reason: null,
    beta: true,
  },
  pricing: {
    ...base().pricing,
    ask_cents: 1_490_000,
    expected_asking_cents: 1_405_000,
    asking_interval_low_cents: 1_380_000,
    asking_interval_high_cents: 1_430_000,
    strong_offer_cents: 1_320_000,
    walk_away_above_cents: 1_460_000,
    residual_fraction: 0.06,
    rating: 64,
    rating_band: "plateau",
    estimator: "mileage_regression",
    comps_included: 31,
    comps_with_mileage: 29,
    confidence: "high",
    confidence_reasons: STRUCTURAL_TEXT,
    confidence_limiters: STRUCTURAL,
  },
  vehicle_risk: {
    title_risk: "clean",
    title_message: "Seller states a clean title.",
    decoded_spec: "Touring, AWD, 6-speed automatic, 2.5L, 4-cyl",
    recall_count: 3,
    complaint_count: 412,
    top_complaint_components: [
      ["ELECTRICAL SYSTEM", 96],
      ["ENGINE", 71],
      ["POWER TRAIN", 58],
      ["STRUCTURE", 24],
    ],
    recall_messages: [
      "3 recall campaign(s) issued for this model.",
      "These are recall campaigns issued for this year, make and model. Whether this " +
        "particular vehicle had them performed is not public data -- ask the seller for " +
        "service records, or check the VIN with a franchised dealer.",
    ],
    complaint_messages: [
      "Complaint counts are not adjusted for how many of these were sold, so they cannot be " +
        "compared across models. Treat the breakdown as a list of what to inspect rather " +
        "than as a quality score.",
    ],
  },
  negotiation: {
    leverage: "strong",
    strength: 78,
    days_listed: 38,
    time_on_market_score: 82,
    leverage_points: [
      "Listed 38 days at an unchanged price, which is well past the point most comparable " +
        "vehicles move.",
      'Description says "moving, need gone" — the seller has a deadline the buyer does not.',
    ],
    offer: {
      stance: "negotiate",
      basis: "comps",
      opening_cents: 1_285_000,
      target_cents: 1_350_000,
      walk_away_cents: 1_460_000,
      reasoning: ["Comparable listings support about $14,050."],
      caveat: null,
      withheld_reason: null,
    },
    opening_message: "Hi -- is the 2016 Mazda CX-5 still available?",
    motivated_phrases: ["moving", "need gone"],
    rigid_phrases: [],
  },
  alternatives: {
    message: "2 comparable listings in this search are better priced for what they are.",
    target_is_best: false,
    items: [
      {
        description:
          "2016 Mazda CX-5 - $13,200, 71,400 mi, Kirkwood, MO  [better value by 11% of expected price]",
        url: "https://www.facebook.com/marketplace/item/1234567890/",
        price_cents: 1_320_000,
        mileage: 71_400,
        location_text: "Kirkwood, MO",
        advantage: 0.11,
        mileage_tradeoff: false,
      },
      {
        description:
          "2015 Mazda CX-5 - $11,900, 104,000 mi, Belleville, IL  [better value by 8% of " +
          "expected price]  (higher mileage - a trade-off, not a straight win)",
        url: "https://www.facebook.com/marketplace/item/2345678901/",
        price_cents: 1_190_000,
        mileage: 104_000,
        location_text: "Belleville, IL",
        advantage: 0.08,
        mileage_tradeoff: true,
      },
    ],
    withheld: [
      {
        description: "2016 Mazda CX-5 - $7,400, 88,000 mi, Granite City, IL",
        url: "https://www.facebook.com/marketplace/item/3456789012/",
        price_cents: 740_000,
        mileage: 88_000,
        location_text: "Granite City, IL",
        reason:
          "Advertised 38% below what comparable listings suggest, with nothing explaining " +
          "why. A discount this deep is more often a problem with the car than a saving.",
      },
    ],
    different_trim: [],
  },
  known_issues: {
    summary:
      "A 2016 CX-5 at this mileage is generally past its early problems, and the ones that " +
      "remain are cheap to check for on the viewing.",
    failure_modes: [
      "Front suspension bushings and sway bar links wear early on this generation and knock " +
        "over broken pavement.",
      "Infotainment head units of this year are known to freeze and reboot; a software " +
        "update fixes most cases.",
    ],
    inspect: [
      "Listen for a knock from the front over rough road at low speed.",
      "Check the tailgate and rear arch seams for the paint bubbling this generation is " +
        "known for.",
    ],
    ask: ["Has the front suspension been apart?", "Which oil change interval has it been on?"],
    ownership_notes: [
      "Fuel economy and insurance both sit close to segment norms; nothing about this model " +
        "is unusually expensive to run.",
    ],
    model: "claude-haiku-4-5-20251001",
    mileage_band: "60k-90k",
    generated_at: "2026-07-20T10:14:00Z",
    cached: true,
  },
};

export const UNRELIABLE = {
  ...base(),
  completeness: {
    present: ["price", "year", "make", "model", "photos"],
    missing: ["mileage", "VIN", "title status", "description"],
  },
  vehicle_details: {
    ...base().vehicle_details,
    mileage: null,
    seller_type: "private_party",
  },
  headline:
    "41 / 100, low confidence. Comparable listings suggest an expected asking range of " +
    "$9,100 to $15,400. This asks $12,600.",
  deal_score: {
    score: 41,
    components: COMPONENTS(38, 54, null, 75),
    coverage: 0.75,
    suppressed_reason: null,
    beta: true,
  },
  pricing: {
    ...base().pricing,
    ask_cents: 1_260_000,
    expected_asking_cents: 1_225_000,
    asking_interval_low_cents: 910_000,
    asking_interval_high_cents: 1_540_000,
    residual_fraction: 0.03,
    rating: 38,
    rating_band: "plateau",
    comps_included: 4,
    comps_with_mileage: 3,
    year_window: 3,
    year_window_widened: true,
    confidence: "low",
    confidence_reasons: [
      ...STRUCTURAL_TEXT,
      "Fewer comparable listings than the model wants.",
      "Trim could not be determined for most comparable listings, so they may not be the " +
        "same specification.",
      "Too few same-year listings, so the comparison was widened to nearby model years. " +
        "Those are similar cars, not identical ones.",
      "Comparable asks are spread widely, so the expected range is broad.",
    ],
    confidence_limiters: [
      ...STRUCTURAL,
      "comp_count",
      "trim_unknown",
      "widened_year_window",
      "wide_interval",
    ],
    fallback_reasons: ["Year window widened from 1 to 3 to reach a usable comp count."],
  },
  seller_risk: {
    seller_type: "private",
    dealer_markers: [],
    scam_warning: false,
    scam_signals_fired: ["few_photos", "minimal_description"],
    scam_signals_evaluable: 5,
    scam_signals_total: 7,
    scam_reduced_sensitivity: true,
    seller_rating_average: null,
    seller_rating_count: null,
    messages: [
      "Two photos, both of the same side of the car.",
      "The description is under 20 words and says nothing specific about the vehicle.",
    ],
  },
  negotiation: {
    leverage: "unknown",
    strength: 50,
    days_listed: null,
    time_on_market_score: null,
    leverage_points: ["No posted date on this listing, so time on market is unknown."],
    offer: {
      stance: "withheld",
      basis: "none",
      opening_cents: null,
      target_cents: null,
      walk_away_cents: null,
      reasoning: [],
      caveat: null,
      withheld_reason: "No posted date on this listing, so there is no way to gauge leverage.",
    },
    opening_message: null,
    motivated_phrases: [],
    rigid_phrases: ["firm on price"],
  },
  alternatives: {
    message: "No comparable listings carried enough detail to rank.",
    target_is_best: false,
    items: [],
    withheld: [],
    different_trim: [],
  },
  // Spec 6.6 switched off in this deployment. The panel hides the section
  // rather than explaining the server's configuration to a car buyer.
  known_issues_unavailable_reason:
    "Not available: no Claude API key is configured. Spec 6.6's model-specific known issues " +
    "are the one part of this evaluation with a per-call cost, so they are off unless a key " +
    "is set.",
  known_issues_unavailable_code: "deployment_not_configured",
};

export const SCAM = {
  ...base(),
  completeness: {
    present: ["price", "year", "make", "model"],
    missing: ["mileage", "VIN", "title status", "description", "photos"],
  },
  vehicle_details: {
    ...base().vehicle_details,
    title_status: null,
    seller_type: null,
    owner_count: "three_plus",
  },
  vehicle: "2018 Honda Civic EX",
  headline:
    "score withheld, medium confidence. Comparable listings suggest an expected asking " +
    "range of $15,900 to $17,200. This asks $8,400.",
  deal_score: {
    score: null,
    components: COMPONENTS(22, 31, 70, 0),
    coverage: 1,
    suppressed_reason:
      "Several scam patterns fired together on this listing. A single score would bury " +
      "that; read the warning instead.",
    beta: true,
  },
  pricing: {
    ...base().pricing,
    ask_cents: 840_000,
    expected_asking_cents: 1_655_000,
    asking_interval_low_cents: 1_590_000,
    asking_interval_high_cents: 1_720_000,
    residual_fraction: -0.49,
    rating: 22,
    rating_band: "implausible_discount",
    comps_included: 22,
    comps_with_mileage: 21,
    confidence: "medium",
    confidence_reasons: [
      ...STRUCTURAL_TEXT,
      "The asking price is far below comparable listings with no stated reason. Unexplained " +
        "discounts this deep are more often a problem than a bargain.",
    ],
    confidence_limiters: [...STRUCTURAL, "adverse_selection"],
  },
  vehicle_risk: {
    ...base().vehicle_risk,
    title_risk: "unstated",
    recall_count: 1,
    complaint_count: 88,
    top_complaint_components: [["ELECTRICAL SYSTEM", 31]],
    recall_messages: [
      "1 recall campaign(s) issued for this model.",
      "Whether this particular vehicle had the work done is not public data.",
    ],
    complaint_messages: [
      "Complaint counts are not adjusted for how many of these were sold, so they cannot " +
        "be compared across models.",
    ],
  },
  seller_risk: {
    seller_type: "private",
    dealer_markers: [],
    scam_warning: true,
    scam_signals_fired: [
      "price_far_below_expected",
      "few_photos",
      "minimal_description",
      "shipping_offered",
    ],
    scam_signals_evaluable: 6,
    scam_signals_total: 7,
    scam_reduced_sensitivity: false,
    messages: [
      "Asking 49% below what comparable listings suggest, with nothing in the description " +
        "explaining why.",
      "One photo, and it appears to be a manufacturer press image.",
      "The description is three words long.",
      'Description offers to ship the vehicle and mentions payment "through the app".',
    ],
  },
  negotiation: {
    ...base().negotiation,
    leverage: "weak",
    days_listed: 1,
    leverage_points: ["Listed today, so you are competing with everyone else who saw it."],
  },
  alternatives: {
    message: "No expected asking price for this vehicle, so there is nothing to rank alternatives against.",
    target_is_best: false,
    items: [],
    withheld: [],
    different_trim: [],
  },
  known_issues_unavailable_reason:
    "The ask is so far below comparable listings, with nothing in the description explaining " +
    "why, that finding out the reason matters more than anything else about this model.",
  known_issues_unavailable_code: "pricing_disqualifier",
};

export const FLAT = {
  ...base(),
  completeness: {
    present: ["price", "mileage", "year", "make", "model", "photos", "description"],
    missing: ["VIN", "title status"],
  },
  vehicle_details: {
    ...base().vehicle_details,
    title_status: "clean",
    seller_type: "dealer",
    owner_count: "two",
  },
  vehicle: "2014 Toyota RAV4 LE",
  headline:
    "66 / 100, medium confidence. Comparable listings suggest an expected asking range of " +
    "$11,400 to $12,600. This asks $12,100.",
  deal_score: {
    score: 66,
    components: COMPONENTS(64, 70, 68, 62),
    coverage: 1,
    suppressed_reason: null,
    beta: true,
  },
  pricing: {
    ...base().pricing,
    ask_cents: 1_210_000,
    expected_asking_cents: 1_200_000,
    asking_interval_low_cents: 1_140_000,
    asking_interval_high_cents: 1_260_000,
    strong_offer_cents: 1_120_000,
    walk_away_above_cents: 1_255_000,
    residual_fraction: 0.008,
    rating: 64,
    rating_band: "plateau",
    comps_included: 17,
    comps_with_mileage: 16,
    confidence: "medium",
    confidence_reasons: STRUCTURAL_TEXT,
    confidence_limiters: STRUCTURAL,
  },
  vehicle_risk: {
    ...base().vehicle_risk,
    title_risk: "clean",
    title_message: "Seller states a clean title.",
    recall_count: 0,
    complaint_count: 140,
    top_complaint_components: [["POWER TRAIN", 40]],
    recall_messages: ["No recall campaigns found for this year, make and model."],
    complaint_messages: [
      "Complaint counts are not adjusted for how many of these were sold, so they cannot " +
        "be compared across models.",
    ],
  },
  negotiation: {
    ...base().negotiation,
    leverage: "moderate",
    days_listed: 12,
    leverage_points: ["Listed 12 days, which is around the median for this model locally."],
    offer: {
      stance: "negotiate",
      basis: "comps",
      opening_cents: 1_120_000,
      target_cents: 1_180_000,
      walk_away_cents: 1_255_000,
      reasoning: ["Comparable listings support about $12,000."],
      caveat: null,
      withheld_reason: null,
    },
    opening_message: "Hi -- is the 2014 Toyota RAV4 LE still available?",
  },
  alternatives: {
    message:
      "This listing is priced better than at least half of its comparable listings, so " +
      "alternatives are not worth the distraction.",
    target_is_best: false,
    items: [],
    withheld: [],
    different_trim: [],
  },
};

// AI Insights, not yet generated: the gate allows a call and nothing is
// cached for this vehicle/mileage band yet, but the eager evaluation never
// pays for one -- only opening the section does (`ai-insights.ts`). The
// static preview can only show the clickable idle state; "Generating..." and
// the loaded/error repaints only exist after a real click sends
// `FETCH_KNOWN_ISSUES`, which this offline harness never does.
export const PENDING = {
  ...base(),
  vehicle: "2019 Honda Civic Sport",
  headline:
    "70 / 100, medium confidence. Comparable listings suggest an expected asking range of " +
    "$16,800 to $18,100. This asks $17,400.",
  deal_score: {
    score: 70,
    components: COMPONENTS(68, 74, 71, 100),
    coverage: 1,
    suppressed_reason: null,
    beta: true,
  },
  known_issues_pending: true,
};
