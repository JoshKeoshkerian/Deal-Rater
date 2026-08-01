/**
 * Messages between the content script and the service worker.
 *
 * The split exists because the content script cannot reach the backend: a
 * cross-origin fetch from a facebook.com page would need CORS on every
 * response and would run under the page's origin. The service worker holds the
 * backend host permission and owns all outbound API traffic.
 */

import type {
  CapturePayload,
  CaptureResponse,
  EvaluationResponse,
  ExtractionIssue,
  ObservationPayload,
} from "./types";

export type ContentToBackground =
  | { type: "SUBMIT_CAPTURE"; payload: CapturePayload }
  | { type: "HARVEST_COMPS_VIA_TAB"; url: string }
  | { type: "HARVEST_TARGET_VIA_TAB"; url: string }
  | { type: "CONTENT_READY"; url: string }
  | { type: "FETCH_EVALUATION"; captureId: number }
  // --- accounts and saved evaluations --------------------------------------
  // The content script never holds the session token; it asks for an outcome.
  // See `shared/session.ts`.
  | { type: "AUTH_STATE" }
  | { type: "AUTH_REQUEST_CODE"; email: string }
  | { type: "AUTH_VERIFY_CODE"; email: string; code: string }
  | { type: "AUTH_SIGN_OUT" }
  | { type: "SAVED_STATE"; captureId: number }
  | { type: "SAVE_EVALUATION"; captureId: number }
  | { type: "UNSAVE_EVALUATION"; captureId: number };

export type BackgroundToContent = { type: "HARVEST_COMPS" } | { type: "HARVEST_TARGET" };

export type SubmitCaptureResult =
  | { ok: true; response: CaptureResponse }
  | { ok: false; error: string };

export type EvaluationResult =
  | { ok: true; evaluation: EvaluationResponse }
  | { ok: false; error: string };

export type HarvestResult =
  | { ok: true; observations: ObservationPayload[]; issues: ExtractionIssue[] }
  | { ok: false; error: string };

/**
 * A target-listing extraction carried back from a background tab. Mirrors
 * `extract/listing.ts`'s `TargetExtraction`, restated here rather than imported
 * so this file does not depend on `extract` -- everything under `extract`
 * already depends on `shared`, and importing the other way would make that a
 * cycle.
 */
export interface HarvestedTarget {
  observation: ObservationPayload;
  issues: ExtractionIssue[];
  pageSignature: string;
  usable: boolean;
  locationId: string | null;
  searchRadiusKm: number | null;
  payloadMatched: boolean;
}

export type HarvestTargetResult = ({ ok: true } & HarvestedTarget) | { ok: false; error: string };

/** Who is signed in on this install, if anyone. */
export type AuthStateResult =
  | { ok: true; signedIn: false }
  | { ok: true; signedIn: true; email: string }
  | { ok: false; error: string };

export type AuthActionResult = { ok: true } | { ok: false; error: string };

export type AuthVerifyResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

/**
 * Whether this evaluation is saved.
 *
 * `signedIn: false` is a successful answer rather than an error: "nobody is
 * signed in" is the state the button renders as its default, and treating it as
 * a failure would put an error message in front of every user who has not made
 * an account yet -- which is all of them, on first run.
 */
export type SavedStateResult =
  | { ok: true; signedIn: false }
  | { ok: true; signedIn: true; saved: boolean }
  | { ok: false; error: string };

export function sendToBackground<T>(message: ContentToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
