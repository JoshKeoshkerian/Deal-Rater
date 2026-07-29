/**
 * Wire contract, mirroring backend/app/schemas.py.
 *
 * The backend rejects unknown fields, so this file and schemas.py must stay in
 * step. Anything added here without a matching Pydantic field produces a 422.
 */

export type Role = "target" | "comp";
export type Scope = "target" | "comp_card" | "comp_search";
export type IssueStatus = "missing" | "unparsed" | "suspect";
export type Expectation = "required" | "expected" | "optional";
export type MileageUnit = "mi" | "km";

/** Ordered from most to least trustworthy. Recorded per field so that a shift
 * in which tier is winning shows up in telemetry before fields go null. */
export type StrategyName =
  | "json_payload"
  /**
   * Parsed out of the listing TITLE STRING, as distinct from read off a
   * structured payload key.
   *
   * These were both reported as `json_payload` until the vehicle cascades were
   * fixed, which made the two indistinguishable in telemetry -- the exact
   * degradation `field_strategies` exists to catch. A title parse is a genuine
   * step down in trust from a payload field even though the title itself came
   * out of the payload, so it gets its own name.
   */
  | "title_text"
  | "meta_tag"
  | "aria_dom"
  | "text_pattern"
  | "url_path";

/**
 * Spec 8.2: identity never leaves the browser in any form other than the
 * hash. `rating_average` and `rating_count` are the buyer-facing star rating
 * Marketplace already shows on the listing page itself (no profile visit
 * required) -- a reputation NUMBER, not identity, so it's exempt from the
 * "never collected" list (display name, profile URL, photo, join date) the
 * same way `active_vehicle_listing_count` already was.
 */
export interface SellerPayload {
  seller_hash: string;
  hash_version: number;
  active_vehicle_listing_count: number | null;
  rating_average: number | null;
  rating_count: number | null;
}

export interface ObservationPayload {
  source: "facebook_marketplace";
  source_listing_id: string;
  listing_url: string | null;
  role: Role;

  price_cents: number | null;
  currency: string | null;
  mileage: number | null;
  mileage_unit: MileageUnit | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim_text: string | null;
  /**
   * Provenance for `trim_text`: "fb_catalog" | "title_text" | "description".
   *
   * `trim_text` stays verbatim (the backend derives the decomposed trim columns
   * from it), so this is the only thing that distinguishes Facebook's catalog
   * string from a seller's free text once the row is stored.
   */
  trim_source: string | null;
  /** Marketplace's own "PRIVATE_SELLER" / "DEALER" classification (spec 4.3). */
  seller_type: string | null;
  /** "AUTOMATIC" / "MANUAL", straight from the payload. */
  transmission: string | null;
  title_status: string | null;
  description: string | null;
  photo_count: number | null;
  posted_at: string | null;
  posted_relative_text: string | null;
  price_changed: boolean | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  vin: string | null;

  seller: SellerPayload | null;

  field_strategies: Record<string, StrategyName>;
  raw_extract: Record<string, unknown> | null;
}

export interface ExtractionIssue {
  scope: Scope;
  field_name: string;
  status: IssueStatus;
  expectation: Expectation;
  strategies_attempted: string[];
  page_signature: string | null;
}

export interface CapturePayload {
  client: { name: string; version: string };
  capture: {
    client_capture_id: string;
    captured_at: string;
    comp_search_query: Record<string, unknown> | null;
  };
  target: ObservationPayload;
  comps: ObservationPayload[];
  extraction_report: ExtractionIssue[];
}

export interface CaptureResponse {
  capture_id: number;
  client_capture_id: string;
  duplicate: boolean;
  listings_ingested: number;
  observations_written: number;
  extraction_reports_written: number;
  extraction_ok: boolean;
}

/* -------------------------------------------------------------------------- */
/* evaluation response (spec 7, build step 8)                                  */
/* -------------------------------------------------------------------------- */

export interface ScoreComponent {
  name: string;
  weight: number;
  value: number | null;
  unavailable_reason: string | null;
}

export interface EvaluationResponse {
  capture_id: number;
  headline: string;
  vehicle: string;
  deal_score: {
    score: number | null;
    components: ScoreComponent[];
    coverage: number;
    suppressed_reason: string | null;
    /** Spec 9: true until the ground truth set exists. */
    beta: boolean;
  };
  pricing: {
    ask_cents: number | null;
    expected_asking_cents: number | null;
    asking_interval_low_cents: number | null;
    asking_interval_high_cents: number | null;
    interval_coverage: number;
    strong_offer_cents: number | null;
    walk_away_above_cents: number | null;
    residual_fraction: number | null;
    rating: number | null;
    rating_band: string | null;
    rating_calibrated: boolean;
    estimator: string;
    comps_included: number;
    comps_with_mileage: number;
    /** Above the default when progressive widening ran (spec 4.3). */
    year_window: number;
    year_window_widened: boolean;
    confidence: string;
    confidence_reasons: string[];
    /**
     * The same limiters as codes, in the same order as `confidence_reasons`.
     *
     * That order is append order, not severity, and its first entries are the
     * structural limiters that fire on every single evaluation. The overlay
     * ranks by code to name the two problems that actually describe THIS comp
     * set -- see `overlay/state.ts`.
     */
    confidence_limiters: string[];
    fallback_reasons: string[];
  };
  /** The target's stated facts (spec 4.1), shown next to the pricing figures. */
  vehicle_details: {
    year: number | null;
    make: string | null;
    model: string | null;
    mileage: number | null;
    title_status: string | null;
  };
  vehicle_risk: {
    title_risk: string;
    title_message: string;
    decoded_spec: string | null;
    recall_count: number | null;
    complaint_count: number | null;
    top_complaint_components: Array<[string, number]>;
    recall_messages: string[];
    complaint_messages: string[];
  };
  /** Null when there is nothing to say (spec 7.4). */
  seller_risk: {
    seller_type: string;
    dealer_markers: string[];
    scam_warning: boolean;
    scam_signals_fired: string[];
    scam_signals_evaluable: number;
    scam_signals_total: number;
    scam_reduced_sensitivity: boolean;
    seller_rating_average: number | null;
    seller_rating_count: number | null;
    messages: string[];
  } | null;
  negotiation: {
    leverage: string;
    strength: number;
    days_listed: number | null;
    time_on_market_score: number | null;
    leverage_points: string[];
    suggested_offer_cents: number | null;
    motivated_phrases: string[];
    rigid_phrases: string[];
  };
  alternatives: {
    message: string;
    target_is_best: boolean;
    items: Array<{
      description: string;
      url: string | null;
      price_cents: number | null;
      mileage: number | null;
      location_text: string | null;
      advantage: number;
      mileage_tradeoff: boolean;
    }>;
    /**
     * Better-priced comps that are deliberately not recommended, each carrying
     * its own reason. Shown with the reason attached or not at all: a count of
     * withheld listings tells a buyer something exists, declines to say what,
     * and reads as concealment.
     */
    withheld: Array<{
      description: string;
      url: string | null;
      price_cents: number | null;
      mileage: number | null;
      location_text: string | null;
      reason: string;
    }>;
  };
  /**
   * Spec 6.6. Null whenever the section cannot be shown -- no API key, spec
   * 10's cost gate, or a failed call -- and the reason then says which.
   *
   * QUALITATIVE ONLY: spec 6.6 forbids dollar estimates, and the backend
   * strips any that slip through, so no field here carries a figure.
   */
  known_issues: {
    summary: string;
    failure_modes: string[];
    inspect: string[];
    ask: string[];
    ownership_notes: string[];
    model: string | null;
    mileage_band: string | null;
    generated_at: string | null;
    cached: boolean;
  } | null;
  known_issues_unavailable_reason: string | null;
  /**
   * Which kind of absence. Codes prefixed `deployment_` are facts about the
   * server (no API key, switched off, offline, call failed) and are never shown
   * to a buyer -- the section is hidden instead. Every other code is spec 10's
   * gate returning a VERDICT about the car, which is a finding.
   */
  known_issues_unavailable_code: string | null;
  notices: string[];
}
