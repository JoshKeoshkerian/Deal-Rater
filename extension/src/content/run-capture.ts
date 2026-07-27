/**
 * One capture run. Triggered by an explicit click and by nothing else.
 *
 * Sequence: extract the listing the user has open, run one comp search for it,
 * post both. There is no retry loop, no schedule, and no state carried between
 * runs — when this function returns, the extension is idle again.
 */

import { buildCompSearch } from "../comps/build-query";
import { runCompSearch } from "../comps/fetch-search";
import { extractTargetListing } from "../extract/listing";
import { collapseIssues } from "../extract/self-check";
import type { EvaluationResult, SubmitCaptureResult } from "../shared/messages";
import { sendToBackground } from "../shared/messages";
import { renderEvaluation } from "./overlay";
import type { CapturePayload, ExtractionIssue, ObservationPayload } from "../shared/types";

export const CLIENT_NAME = "chrome-extension";
export const CLIENT_VERSION = "0.1.0";

export interface CapturePayloadParts {
  capturedAt: Date;
  captureId: string;
  target: ObservationPayload;
  comps: ObservationPayload[];
  issues: ExtractionIssue[];
  compSearchQuery: Record<string, unknown> | null;
}

/**
 * Assemble the wire payload.
 *
 * Split out from the run so that the contract can be tested without a browser.
 * `contract/capture-example.json` is checked against both this function's
 * output and the backend's Pydantic model, which is what stops the two sides
 * drifting into a 422 that only shows up in production.
 */
export function buildCapturePayload(parts: CapturePayloadParts): CapturePayload {
  return {
    client: { name: CLIENT_NAME, version: CLIENT_VERSION },
    capture: {
      client_capture_id: parts.captureId,
      captured_at: parts.capturedAt.toISOString(),
      comp_search_query: parts.compSearchQuery,
    },
    target: parts.target,
    comps: parts.comps,
    extraction_report: collapseIssues(parts.issues),
  };
}

export type StatusListener = (message: string) => void;

export interface CaptureOutcome {
  ok: boolean;
  message: string;
  compCount: number;
  extractionOk: boolean;
}

export async function runCapture(onStatus: StatusListener = () => {}): Promise<CaptureOutcome> {
  const capturedAt = new Date();

  onStatus("Reading listing…");
  const target = await extractTargetListing(document, location.href, capturedAt);

  if (!target.usable) {
    return {
      ok: false,
      message: "Could not identify this listing. Open a Marketplace item page and try again.",
      compCount: 0,
      extractionOk: false,
    };
  }

  // Marketplace is a single-page app: clicking from one listing to another
  // swaps the URL before the new listing's payload arrives. Capturing in that
  // window used to pair the new id with the previous car's data. The payload
  // lookup now refuses to guess, so the symptom here is a listing with an id
  // and a URL but no vehicle at all.
  //
  // Refusing beats submitting. A capture with no make, model or price is not
  // worth a row, and telling the user to retry costs them one click.
  const { make, model, price_cents: priceCents } = target.observation;
  if (make === null && model === null && priceCents === null) {
    return {
      ok: false,
      message: "This listing is still loading. Give it a moment and click again.",
      compCount: 0,
      extractionOk: false,
    };
  }

  const issues: ExtractionIssue[] = [...target.issues];

  const search = buildCompSearch(target.observation, target.locationId);
  let comps: CapturePayload["comps"] = [];
  let compSource = "none";
  // Whether the comp set actually came back scoped to the target's location.
  // Step 3 reads this: comps from an unknown market widen the interval.
  let locationScoped = search?.query.location_id !== null;

  if (search === null) {
    // Without make and model there is nothing to search for. Recorded rather
    // than silently skipped, because it is the same shape of failure as a
    // broken selector and belongs in the same telemetry.
    issues.push({
      scope: "comp_search",
      field_name: "comp_search_query",
      status: "missing",
      expectation: "expected",
      strategies_attempted: [],
      page_signature: target.pageSignature,
    });
  } else {
    onStatus("Searching comparable listings…");
    let result = await runCompSearch(search.url, capturedAt);

    // An unrecognised location parameter yields zero results rather than an
    // error, which is indistinguishable from a genuinely empty market — the
    // thing step 0 exists to measure. Retry unscoped so the two stay separable.
    if (result.observations.length === 0 && search.fallbackUrl) {
      result = await runCompSearch(search.fallbackUrl, capturedAt);
      locationScoped = false;
    }

    compSource = result.source;

    // A search page routinely includes the listing being evaluated. Keeping it
    // would make the target its own comp in step 3.
    comps = result.observations.filter(
      (comp) => comp.source_listing_id !== target.observation.source_listing_id,
    );

    issues.push(...result.issues);

    if (result.source === "none") {
      issues.push({
        scope: "comp_search",
        field_name: "comp_results",
        status: "missing",
        expectation: "expected",
        strategies_attempted: ["json_payload", "aria_dom"],
        page_signature: target.pageSignature,
      });
    }
  }

  const payload = buildCapturePayload({
    capturedAt,
    captureId: crypto.randomUUID(),
    target: target.observation,
    comps,
    issues,
    compSearchQuery: search
      ? { ...search.query, source: compSource, location_scoped: locationScoped }
      : null,
  });

  onStatus("Saving…");
  const result = await sendToBackground<SubmitCaptureResult>({
    type: "SUBMIT_CAPTURE",
    payload,
  });

  if (!result?.ok) {
    return {
      ok: false,
      message: result?.error ?? "No response from the extension background worker.",
      compCount: comps.length,
      extractionOk: false,
    };
  }

  const { response } = result;

  // Spec 7's overlay. Fetched separately from the ingest so that a scoring
  // failure surfaces as a message rather than discarding a capture the user
  // would have to click again to recreate.
  onStatus("Evaluating\u2026");
  const evaluation = await sendToBackground<EvaluationResult>({
    type: "FETCH_EVALUATION",
    captureId: response.capture_id,
  });
  if (evaluation?.ok) {
    renderEvaluation(evaluation.evaluation);
  }

  const summary = response.duplicate
    ? "Already captured."
    : `Captured with ${comps.length} comparable listing${comps.length === 1 ? "" : "s"}.`;

  return {
    ok: true,
    message: response.extraction_ok ? summary : `${summary} Some fields could not be read.`,
    compCount: comps.length,
    extractionOk: response.extraction_ok,
  };
}
