/**
 * One capture run. Triggered by an explicit click and by nothing else.
 *
 * Sequence: extract the listing the user has open, run one comp search for it,
 * post both. There is no retry loop, no schedule, and no state carried between
 * runs — when this function returns, the extension is idle again.
 */

import type { CaptureStage } from "./capture-stages";
import { buildCompSearch, buildMetroSearch, buildTrimSearch } from "../comps/build-query";
import {
  metroFromLocationText,
  nearestMetro,
  peersFor,
  verifyMetroResults,
} from "../comps/metros";
import {
  TRIM_MATCH_TARGET,
  countTrimMatched,
  countUsable,
  pendingPeers,
  shouldWiden,
} from "../comps/widen";
import { loadBadMetroSlugs, rememberBadMetroSlug } from "../shared/metro-health";
import { fetchDocument, runCompSearch } from "../comps/fetch-search";
import { extractTargetListing } from "../extract/listing";
import { collapseIssues } from "../extract/self-check";
import type {
  EvaluationResult,
  HarvestTargetResult,
  SubmitCaptureResult,
} from "../shared/messages";
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

/**
 * `stage` is optional so that a caller which only wants the sentence -- a test,
 * a script -- can still pass a one-argument function. The trigger button uses
 * it to draw a rail (`capture-stages.ts`).
 */
export type StatusListener = (message: string, stage?: CaptureStage) => void;

export interface CaptureOutcome {
  ok: boolean;
  message: string;
  compCount: number;
  extractionOk: boolean;
}

export async function runCapture(onStatus: StatusListener = () => {}): Promise<CaptureOutcome> {
  const capturedAt = new Date();

  onStatus("Reading listing…", "reading");
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
    onStatus("Loading listing data…", "reading");
    const canonical = target.observation.listing_url ?? location.href;
    const fresh = await fetchDocument(canonical);
    if (fresh) {
      const refetched = await extractTargetListing(fresh, canonical, capturedAt);
      // Only accept it if the re-fetch actually resolved what the page could
      // not. A redirect to a login wall would otherwise replace a partial
      // extraction with an empty one.
      if (refetched.payloadMatched) target = refetched;
    }

    // A same-origin `fetch` is not a real navigation, and `comps/fetch-search.ts`'s
    // `looksLikeShell` documents why that matters: Facebook sometimes answers one
    // with a stripped shell instead of the full rendered page. When that happens
    // here, the fetch above silently leaves the stale extraction in place -- the
    // field cascades still run, but against a page describing the wrong listing,
    // which is exactly the "fields blank on the right car" failure a manual
    // refresh always fixed, because a refresh IS a real navigation. This is that
    // same real navigation, run by the extension in a background tab instead of
    // by hand, the same escalation the comp search already makes.
    if (!target.payloadMatched) {
      onStatus("Reloading listing…", "reading");
      const harvested = await sendToBackground<HarvestTargetResult>({
        type: "HARVEST_TARGET_VIA_TAB",
        url: canonical,
      });
      if (harvested?.ok && harvested.payloadMatched) {
        target = {
          observation: harvested.observation,
          issues: harvested.issues,
          pageSignature: harvested.pageSignature,
          usable: harvested.usable,
          locationId: harvested.locationId,
          searchRadiusKm: harvested.searchRadiusKm,
          payloadMatched: harvested.payloadMatched,
        };
      }
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
  const metrosFailed: string[] = [];
  // Which metro the peer list was drawn from, and how it was identified.
  // Recorded because "no peers were available" and "the listing's market could
  // not be identified" are different failures that used to look identical in
  // the data -- both appeared as an empty `extra_metros_searched`.
  let homeMetro: string | null = null;
  let homeMetroSource: "coordinates" | "location_text" | null = null;
  // The home search's own composition and the trim query's contribution. All
  // null / zero when no search ran at all, which the payload distinguishes from
  // a search that ran and found nothing.
  let homeReturned = 0;
  let homeUsable = 0;
  let trimSearchQuery: string | null = null;
  let trimQueryReturned: number | null = null;
  let trimQueryNew: number | null = null;
  let trimMatchedBefore = 0;
  let trimMatchedAfter = 0;
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
    onStatus("Searching comparable listings…", "comps");
    let result = await runCompSearch(search.url, capturedAt);

    // An unrecognised location parameter yields zero results rather than an
    // error, which is indistinguishable from a genuinely empty market — the
    // thing step 0 exists to measure. Retry unscoped so the two stay separable.
    if (result.observations.length === 0 && search.fallbackUrl) {
      result = await runCompSearch(search.fallbackUrl, capturedAt);
      locationScoped = false;
    }

    compSource = result.source;
    issues.push(...result.issues);

    // Deduplicated AS WE GO, not afterwards.
    //
    // Neighbouring metros overlap -- a St. Louis search and a Springfield search
    // return many of the same cars -- so counting raw results treats the same
    // listing as progress several times over. Widening then stops early
    // believing it has enough: two captures reported 32 raw comps and only 27
    // unique ones, having quit two peers in with six still available.
    const seenIds = new Set<string>([target.observation.source_listing_id]);
    let observations: ObservationPayload[] = [];
    const absorb = (batch: ObservationPayload[]): void => {
      for (const comp of batch) {
        if (seenIds.has(comp.source_listing_id)) continue;
        seenIds.add(comp.source_listing_id);
        observations.push(comp);
      }
    };
    absorb(result.observations);

    // The home page's own composition, recorded BEFORE anything is added to it.
    // This is the exhaustion signal: a page that came back mostly same-model
    // means Facebook still had inventory of this vehicle and simply chose which
    // trims to show, while a page padded out with other models means the radius
    // is genuinely out of them. Hand-measured, the trim query below helped in
    // the first case (Cherokee, 13/14 same-model) and was wasted in the second
    // (Lexus RC, 7/14). Recorded rather than acted on: three observations are
    // not enough to set a threshold, and this is what will set it.
    homeReturned = result.observations.length;
    homeUsable = countUsable(target.observation, observations);
    trimMatchedBefore = countTrimMatched(target.observation, observations);

    // Snapshotted here, and used further down by `metroFromLocationText`. The
    // trim query below is scoped to the same place id so its cities would be
    // just as valid a vote -- but that function's measured accuracy was
    // established on home-search results only, and keeping the input to exactly
    // that is cheaper than re-establishing it.
    const homeCities = observations.map((o) => o.location_text);

    // ONE trim-worded search in the listing's OWN metro, before any peer.
    //
    // Preferred over an extra peer for the same request because it adds comps
    // from the same market: a peer metro's asks carry that market's price level,
    // which `comps/metros.ts` documents as a real distortion even inside matched
    // rust and price tiers. Measured yield is comparable (+2.3 same-trim comps
    // per request across three hand-run vehicles, against a peer's ~+2), so the
    // tie-breaker is contamination, not count.
    //
    // Gated on there being something to gain: a known trim level, and the trim
    // target not already met. `buildTrimSearch` returns null when the trim
    // reduces to nothing but a body style, and when there is no place id to
    // scope to.
    //
    // Also gated on the home search having stayed scoped. If its scoped URL came
    // back empty and fell back to unscoped, that place id does not resolve, and
    // this query -- which uses the same one and has no fallback of its own --
    // would return zero for the same reason. A guaranteed-empty request.
    if (locationScoped && trimMatchedBefore < TRIM_MATCH_TARGET) {
      const trimSearch = buildTrimSearch(target.observation, target.locationId);
      if (trimSearch) {
        onStatus("Searching this trim…", "comps");
        const trimResult = await runCompSearch(trimSearch.url, capturedAt);
        trimSearchQuery = trimSearch.query.query;
        trimQueryReturned = trimResult.observations.length;
        const before = observations.length;
        absorb(trimResult.observations);
        trimQueryNew = observations.length - before;
        issues.push(...trimResult.issues);
      }
    }
    trimMatchedAfter = countTrimMatched(target.observation, observations);

    // Facebook's 40-mile radius is not settable per request, so a wider market
    // is only reachable as SEPARATE searches centred on other metros. Peers are
    // chosen by market similarity, not just distance -- see comps/metros.ts.
    //
    // Widening is TIERED: it stops as soon as there are enough usable comps, so
    // a common car costs one or two searches and only a scarce one walks the
    // whole peer list. Every peer is another request on a single user click,
    // and spec 8.1 makes that budget a binding constraint rather than a
    // preference.
    // Coordinates first, city names second. The fallback is not a nicety: a
    // listing page that publishes no location object yields a null latitude,
    // and that null used to remove widening entirely -- 32 of 237 post-fix
    // captures searched zero peers for this reason alone and finished on a
    // median of ~10 usable comps against ~34 for the rest. See
    // `metroFromLocationText`.
    //
    // It is handed ONLY the comps from the listing's own market. `observations`
    // holds exactly the home search's results at this point, which is required
    // rather than incidental: given comps pooled across peer metros the
    // fallback votes for whichever peer returned the most listings, and that is
    // widening's output choosing widening's input.
    let home = nearestMetro(target.observation.latitude, target.observation.longitude);
    if (home) {
      homeMetroSource = "coordinates";
    } else {
      // Reached with coordinates too, not only without them: `nearestMetro`
      // also declines beyond `MAX_HOME_METRO_MILES`, so recording the source
      // from `latitude !== null` would mislabel a rural listing.
      home = metroFromLocationText(target.observation.location_text, homeCities);
      if (home) homeMetroSource = "location_text";
    }
    homeMetro = home?.slug ?? null;
    const badSlugs = await loadBadMetroSlugs();
    const manual = settings.extraMetroIds;
    const autoPeers = home ? pendingPeers(peersFor(home), badSlugs) : [];

    // A manual list is an override, not an addition: someone who typed metros
    // in wants those and not a guess layered on top.
    const queue = manual.length > 0 ? manual : autoPeers.map((m) => m.slug);

    let remaining = queue.length;
    for (const slug of queue) {
      if (!shouldWiden(target.observation, observations, remaining--)) break;
      // The listing's own metro is always searched above.
      if (slug === target.locationId) continue;

      const metroSearch = buildMetroSearch(target.observation, slug);
      if (!metroSearch) continue;

      onStatus("Searching nearby markets…", "widening");
      const extra = await runCompSearch(metroSearch.url, capturedAt);

      // An unresolvable slug silently returns the account's own metro rather
      // than erroring, which is indistinguishable from an empty market. Check
      // that the results actually came from where they were asked for.
      const metro = autoPeers.find((m) => m.slug === slug);
      if (metro) {
        const places = extra.observations.map((o) => o.location_text ?? "");
        if (!verifyMetroResults(metro, places)) {
          await rememberBadMetroSlug(slug);
          metrosFailed.push(slug);
          continue;
        }
      }

      absorb(extra.observations);
      metrosSearched.push(slug);
    }

    // Already deduplicated by `absorb`, and the target's own listing was seeded
    // into `seenIds` so a search page returning it cannot make the target its
    // own comp in step 3.
    comps = observations;

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
          // The market the peer list came from, and whether it was identified
          // from coordinates or from city names. Distinguishes "this listing's
          // market could not be identified" from "its peers were all searched",
          // which both used to read as an empty `extra_metros_searched`.
          home_metro: homeMetro,
          home_metro_source: homeMetroSource,
          // The trim-worded search, and enough around it to decide later whether
          // it earns its request. `home_returned` / `home_usable` are the
          // exhaustion signal (see the comment at the call site): the threshold
          // that should skip this query on a market with nothing left to surface
          // is not set from three hand-run vehicles, it is set from these.
          home_returned: homeReturned,
          home_usable: homeUsable,
          trim_query: trimSearchQuery,
          trim_query_returned: trimQueryReturned,
          trim_query_new: trimQueryNew,
          trim_matched_before: trimMatchedBefore,
          trim_matched_after: trimMatchedAfter,
          // Which metros were searched, so a comp set spanning several markets
          // is visible in the data rather than inferred from city names.
          extra_metros_searched: metrosSearched,
          // Slugs that returned another market's listings, so an inferred slug
          // that does not resolve is visible rather than looking like a thin
          // market.
          extra_metros_unresolved: metrosFailed,
          usable_comp_estimate: countUsable(target.observation, comps),
        }
      : null,
  });

  onStatus("Saving…", "saving");
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
  onStatus("Evaluating\u2026", "evaluating");
  const evaluation = await sendToBackground<EvaluationResult>({
    type: "FETCH_EVALUATION",
    captureId: response.capture_id,
  });

  const summary = response.duplicate
    ? "Already captured."
    : `Captured with ${comps.length} comparable listing${comps.length === 1 ? "" : "s"}.`;

  // The capture itself is saved either way -- ingestion already succeeded
  // above -- but if there is no evaluation there is no overlay to show, and
  // returning `ok: true` with the summary alone used to say "Captured with N
  // comparable listings" while silently showing nothing at all, indistinguishable
  // from success. `ok: false` here means "the click didn't finish what it set
  // out to do," not "nothing was saved" -- the message says which one happened.
  if (!evaluation?.ok) {
    return {
      ok: false,
      message:
        `${summary} Could not load the evaluation ` +
        `(${evaluation?.error ?? "no response from the extension background worker"}). ` +
        "Reopen this listing and click again to retry.",
      compCount: comps.length,
      extractionOk: response.extraction_ok,
    };
  }

  renderEvaluation(evaluation.evaluation);

  return {
    ok: true,
    message: response.extraction_ok ? summary : `${summary} Some fields could not be read.`,
    compCount: comps.length,
    extractionOk: response.extraction_ok,
  };
}
