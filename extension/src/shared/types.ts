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
  | "meta_tag"
  | "aria_dom"
  | "text_pattern"
  | "url_path";

/** Spec 8.2: a hash and an integer. There is no third field. */
export interface SellerPayload {
  seller_hash: string;
  hash_version: number;
  active_vehicle_listing_count: number | null;
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
