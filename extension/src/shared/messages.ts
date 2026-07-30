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
  | { type: "FETCH_EVALUATION"; captureId: number };

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

export function sendToBackground<T>(message: ContentToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
