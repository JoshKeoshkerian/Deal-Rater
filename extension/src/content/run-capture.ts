/**
 * One capture run. Triggered by an explicit click and by nothing else.
 *
 * Sequence: extract the listing the user has open, run one comp search for it,
 * post both. There is no retry loop, no schedule, and no state carried between
 * runs — when this function returns, the extension is idle again.
 */

import { buildCompSearch, buildMetroSearch } from "../comps/build-query";
import { fetchDocument, runCompSearch } from "../comps/fetch-search";
import { extractTargetListing } from "../extract/listing";
import { collapseIssues } from "../extract/self-check";
import type { EvaluationResult, SubmitCaptureResult } from "../shared/messages";
import { sendToBackground } from "../shared/messages";
import { loadSettings } from "../shared/settings";
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
  let target = await extractTargetListing(document, location.href, capturedAt);

  // Marketplace is a single-page app: the JSON payloads in the DOM are written
  // at full page load, and clicking listing-to-listing fetches the new data
  // into JavaScript memory without adding script tags. So the payloads on the
  // page describe whichever listing was loaded first, not the one being viewed.
  //
  // Re-fetching the listing URL same-origin returns server-rendered HTML with
  // the correct payloads. Same technique the comp search already uses, and it
  // is what removes the manual refresh that capturing used to require --
  // refreshing was only ever a way of forcing this fetch by hand.
  if (target.usable && !target.payloadMatched) {
    onStatus("Loading listing data…");
    const canonical = target.observation.listing_url ?? location.href;
    const fresh = await fetchDocument(canonical);
    if (fresh) {
      const refetched = await extractTargetListing(fresh, canonical, capturedAt);
      // Only accept it if the re-fetch actually resolved what the page could
      // not. A redirect to a login wall would otherwise replace a partial
      // extraction with an empty one.
      if (refetched.payloadMatched) target = refetched;
    }
  }

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
  const { make, model, year, price_cents: priceCents } = target.observation;
  if (make === null && model === null && priceCents === null) {
    return {
      ok: false,
      message: "This listing is still loading. Give it a moment and click again.",
      compCount: 0,
      extractionOk: false,
    };
  }

  // Nothing that identifies a VEHICLE, yet a price came through: this is a
  // Marketplace listing for something that is not a car. Captured data holds
  // four of these -- $780 and $5,000 rows whose "mileage" of 40 or 100 was a
  // number lifted out of unrelated prose.
  //
  // They cannot be evaluated (no make or model means no comp search runs at
  // all) and they pollute the observation table, which spec 4.4 intends as a
  // vehicle time series. Refusing is better than storing a row that can only
  // ever be noise.
  if (make === null && model === null && year === null) {
    return {
      ok: false,
      message: "This does not look like a vehicle listing. Nothing was saved.",
      compCount: 0,
      extractionOk: false,
    };
  }

  const issues: ExtractionIssue[] = [...target.issues];

  const settings = await loadSettings();
  const metrosSearched: string[] = [];
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
    let observations = result.observations;
    issues.push(...result.issues);

    // Facebook's 40-mile radius is not settable per request, so a wider market
    // is only reachable as SEPARATE searches centred on other metros. Each one
    // costs a request, which is why the list is opt-in and short rather than a
    // radius slider.
    //
    // Still one user-initiated action (spec 8.1): these fire on the same click,
    // and nothing here schedules, repeats or broadens a search on its own.
    for (const metroId of settings.extraMetroIds) {
      // The listing's own metro is always searched above. Repeating it here
      // would spend a request to fetch the same fifteen results again.
      if (metroId === target.locationId) continue;
      const metroSearch = buildMetroSearch(target.observation, metroId);
      if (!metroSearch) continue;
      onStatus(`Searching nearby markets\u2026`);
      const extra = await runCompSearch(metroSearch.url, capturedAt);
      observations = [...observations, ...extra.observations];
      metrosSearched.push(metroId);
    }

    // A search page routinely includes the listing being evaluated. Keeping it
    // would make the target its own comp in step 3. Duplicates ACROSS metros
    // are left to the backend, whose comp filter already dedupes on content --
    // overlapping metro searches legitimately return the same car twice.
    const seenIds = new Set<string>();
    comps = observations.filter((comp) => {
      if (comp.source_listing_id === target.observation.source_listing_id) return false;
      if (seenIds.has(comp.source_listing_id)) return false;
      seenIds.add(comp.source_listing_id);
      return true;
    });

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
      ? {
          ...search.query,
          source: compSource,
          location_scoped: locationScoped,
          // Not settable per request -- Facebook holds it against the account --
          // so recording it is the only way a comp set's geographic scope is
          // ever knowable after the fact.
          search_radius_km: target.searchRadiusKm,
          // Which metros were searched, so a comp set spanning several markets
          // is visible in the data rather than inferred from city names.
          extra_metros_searched: metrosSearched,
        }
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
