/**
 * The slice of the API contract this site reads.
 *
 * Deliberately a SUBSET of `backend/app/schemas.py`'s `EvaluationOut` rather
 * than a transcription of it. The saved list renders a summary card, not the
 * whole overlay, and typing fields nobody displays would create a second
 * contract to keep in sync for no benefit -- every field below is one this
 * site actually puts on screen.
 *
 * Everything optional is optional because the backend genuinely returns null
 * for it: a listing with too few comps has no expected price, an unpriceable
 * one has no score.
 */

export interface DealScore {
  score: number | null;
  /** Spec 9: always true until the ground-truth set exists. */
  beta: boolean;
  suppressed_reason: string | null;
}

export interface Pricing {
  ask_cents: number | null;
  expected_asking_cents: number | null;
  asking_interval_low_cents: number | null;
  asking_interval_high_cents: number | null;
  confidence: string | null;
  comps_included: number | null;
}

export interface VehicleDetails {
  year: number | null;
  make: string | null;
  model: string | null;
  mileage: number | null;
  title_status: string | null;
}

export interface Negotiation {
  leverage: string | null;
  days_listed: number | null;
}

export interface Evaluation {
  capture_id: number;
  headline: string;
  vehicle: string;
  deal_score: DealScore;
  pricing: Pricing;
  vehicle_details: VehicleDetails;
  negotiation: Negotiation;
  /** Spec 7's liability framing and spec 4.5's asking-price notice. */
  notices: string[];
}

export interface SavedEvaluation {
  id: number;
  capture_id: number;
  saved_at: string;
  /** When the snapshot was computed. Rendered as "checked". */
  evaluated_at: string;
  vehicle: string | null;
  listing_url: string | null;
  /**
   * The underlying capture has aged out of the retention window. The snapshot
   * still renders in full; what is gone is the ability to re-run the
   * assessment from stored observations.
   *
   * NOT a claim that the car is sold — that is unknowable here.
   */
  snapshot_only: boolean;
  evaluation: Evaluation;
}

export interface User {
  id: number;
  email: string;
  created_at: string;
}
