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
  | { type: "CONTENT_READY"; url: string }
  | { type: "FETCH_EVALUATION"; captureId: number };

export type BackgroundToContent = { type: "HARVEST_COMPS" };

export type SubmitCaptureResult =
  | { ok: true; response: CaptureResponse }
  | { ok: false; error: string };

export type EvaluationResult =
  | { ok: true; evaluation: EvaluationResponse }
  | { ok: false; error: string };

export type HarvestResult =
  | { ok: true; observations: ObservationPayload[]; issues: ExtractionIssue[] }
  | { ok: false; error: string };

export function sendToBackground<T>(message: ContentToBackground): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
