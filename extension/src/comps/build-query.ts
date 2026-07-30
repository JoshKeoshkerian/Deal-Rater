/**
 * Building the comp search (spec 4.3).
 *
 * One search, on the click, for the vehicle the user is already looking at.
 * Nothing here schedules, repeats, or broadens a search on its own — that is
 * the binding constraint in 8.1 and it is a property of the code, not a policy.
 *
 * The search is scoped to the *target listing's* location, not the user's
 * Marketplace location. That was a real defect in captured data and it is
 * silent: the comp set looks populated and is simply about a different market.
 * A Nashville listing was benchmarked entirely against St. Louis comps.
 *
 * HOW MARKETPLACE ACTUALLY SCOPES LOCATION
 * ----------------------------------------
 * By PATH SEGMENT, not by query parameter:
 *
 *     /marketplace/<location_vanity_or_id>/search/?query=...
 *
 * An earlier attempt here passed `latitude`/`longitude`/`radius_km` as query
 * parameters. Facebook ignores those and returns zero results, which the
 * fallback below caught — capture 6 came back with `location_scoped: false`,
 * proving the parameters were wrong rather than merely unverified.
 *
 * The place id is confirmed against captured listing pages: every one carries
 * exactly one `location_vanity_or_id` matching its own city, and Marketplace's
 * own category links use it in this position.
 *
 * A wrong path still returns zero rather than erroring, so `fallbackUrl` stays:
 * an unrecognised location costs one extra request instead of silently emptying
 * the comp set.
 *
 * The search is also scoped to the Vehicles category, whose id is confirmed
 * from the same captured pages. That keeps dash kits and car stereos out of a
 * result page that only returns about fifteen rows.
 *
 * Radius is still NOT set. Payloads carry `"location":{"radius":65}` and the
 * search UI clearly has a radius control, but no observed URL contains the
 * parameter that sets it, so it may well live server-side against the account
 * rather than in the link. Widening by radius therefore stays unbuilt; step 3
 * widens the year range instead, which measurement showed matters more anyway.
 */

import type { ObservationPayload } from "../shared/types";
import { trimLevelQueryTerm } from "./trim-level";

const MARKETPLACE_ROOT = "https://www.facebook.com/marketplace";
const SEARCH_BASE = `${MARKETPLACE_ROOT}/search/`;

/**
 * A Marketplace location is either a 15-digit place id or a vanity slug.
 *
 * Both forms are confirmed from captured data: `/marketplace/chicago/search`
 * returned Alsip, Naperville, Gurnee and Hammond, and
 * `/marketplace/108013345886344/search` returns St. Louis metro. Facebook seems
 * to use the slug wherever one exists and the numeric id otherwise.
 *
 * A 16-digit number is NOT one of these -- that mistake cost a whole capture,
 * because an unrecognised path silently falls back to the account's own metro
 * and looks identical to a market with nothing in it.
 */
const LOCATION_ID_RE = /^(?:[0-9]{15}|[a-z][a-z0-9-]{2,40})$/i;

/**
 * Marketplace's "Vehicles" taxonomy id.
 *
 * Confirmed twice from captured pages, not guessed: the category menu links to
 * `/marketplace/<place>/search/?category_id=546583916084032`, and the embedded
 * taxonomy payload carries `{"id":"546583916084032","name":"Vehicles"}`.
 *
 * Scoping to it keeps parts and accessories out of the result set at the
 * source. `looks_like_a_part` in the backend still exists as a second line --
 * captured data contained a $25 dash kit and a $180 head unit that both parsed
 * cleanly as vehicles -- but filtering server-side is cheaper than filtering
 * ours, and every excluded result is a wasted slot on a page that only returns
 * about fifteen.
 */
const VEHICLES_CATEGORY_ID = "546583916084032";

export interface CompSearchQuery extends Record<string, unknown> {
  query: string;
  /** What the query was built from, so a bad comp set can be diagnosed later. */
  derived_from: {
    year: number | null;
    make: string | null;
    model: string | null;
    /** The trim level named in the query, or null on the plain search. */
    trim: string | null;
  };
  /**
   * The Facebook place id the search was scoped to, or null when the listing
   * page carried none. Recorded whether or not the search honoured it, so a
   * comp set drawn from the wrong metro is visible in the data rather than
   * having to be inferred from city names after the fact.
   */
  location_id: string | null;
}

export interface CompSearch {
  url: string;
  query: CompSearchQuery;
  /**
   * The same search with the location parameters stripped. Facebook silently
   * returns zero results for an unrecognised parameter rather than erroring, so
   * the caller retries with this before concluding the market is empty.
   */
  fallbackUrl: string | null;
}

/**
 * Build the search for a target listing.
 *
 * Returns null when there is not enough to search on. A search for "Toyota"
 * alone would return a comp set that looks populated and is meaningless, which
 * is worse for step 3 than returning nothing: the confidence model can react
 * to an empty comp set but not to a plausible wrong one.
 */
/**
 * Build the same search centred on a different metro.
 *
 * Facebook's radius is fixed at 40 miles and cannot be set per request, so a
 * wider market is only reachable as several searches at different centres.
 * Returns null for an id that does not look like a place id, rather than
 * building a path that would 404 into an empty comp set.
 */
export function buildMetroSearch(
  target: ObservationPayload,
  metroId: string,
): CompSearch | null {
  if (!LOCATION_ID_RE.test(metroId)) return null;
  return buildCompSearch(target, metroId);
}

/**
 * The same search with the target's trim level named in the query.
 *
 * MEASURED BEFORE BUILT, and the result is conditional rather than clean. Three
 * hand-run pairs in the listing's own metro, counting same-model-and-same-trim
 * cards on the first page:
 *
 *     vehicle                        plain -> trim   same-model on plain page
 *     2019 Jeep Cherokee Limited         7 -> 13            13 / 14
 *     2016 Mazda CX-5 Grand Touring      5 ->  6            14 / 14
 *     2015 Lexus RC F Sport              3 ->  3             7 / 14
 *
 * Facebook is not ANDing the token -- `total` came back 14 on all six pages, so
 * the result set is the same size and the trim word only reorders what surfaces.
 * Which means the query can only help when there is latent supply of that trim
 * to reorder INTO view:
 *
 *   - Cherokee: the plain page was already 13/14 same-model, so Facebook had
 *     Limiteds deeper in the set and naming the trim brought them forward.
 *   - Lexus RC: the plain page was 7/14 same-model, i.e. Facebook padded with
 *     other models because it had run out of RCs inside the radius. There is no
 *     eighth RC to surface and no wording can invent one. That case needs
 *     geographic widening, which is what the peer loop is for.
 *   - CX-5: moved by one card, indistinguishable from noise.
 *
 * So: one clear win, one null, one wasted request out of three. Worth one
 * request on the cases that can benefit, not worth firing unconditionally --
 * see `run-capture.ts` for the gate, and the recorded per-query counts, which
 * exist so the "market is exhausted, skip it" threshold can be set from data
 * rather than from these three rows.
 *
 * NEVER RUNS UNSCOPED, unlike `buildCompSearch`, and that is the same decision
 * twice over: no `fallbackUrl`, and null when there is no place id to scope to.
 * An unrecognised or absent location makes Facebook return the ACCOUNT's own
 * metro. The plain search accepts that trade because some comps beat none. A
 * supplementary query does not -- it would spend a request adding a second
 * helping of the wrong market to a comp set that is already drawn from it, which
 * is the defect this file exists to prevent. Zero results, or no search at all,
 * is the correct answer.
 */
export function buildTrimSearch(
  target: ObservationPayload,
  locationId: string | null,
): CompSearch | null {
  if (!LOCATION_ID_RE.test(locationId ?? "")) return null;
  const trimTerm = trimLevelQueryTerm(target.trim_text, target.model);
  if (trimTerm === null) return null;
  const search = buildCompSearch(target, locationId, trimTerm);
  if (search === null) return null;
  return { ...search, fallbackUrl: null };
}

export function buildCompSearch(
  target: ObservationPayload,
  locationId: string | null = null,
  trimTerm: string | null = null,
): CompSearch | null {
  const { year, make, model } = target;
  if (!model || !make) return null;

  const terms = [year !== null ? String(year) : null, make, model, trimTerm].filter(Boolean);
  const query = terms.join(" ");
  const derived = { year, make, model, trim: trimTerm };

  const unscoped = new URL(SEARCH_BASE);
  unscoped.searchParams.set("query", query);
  unscoped.searchParams.set("category_id", VEHICLES_CATEGORY_ID);

  const scoped = LOCATION_ID_RE.test(locationId ?? "") ? locationId : null;
  if (scoped === null) {
    return {
      url: unscoped.toString(),
      fallbackUrl: null,
      query: { query, derived_from: derived, location_id: null },
    };
  }

  const url = new URL(`${MARKETPLACE_ROOT}/${scoped}/search/`);
  url.searchParams.set("query", query);
  url.searchParams.set("category_id", VEHICLES_CATEGORY_ID);

  return {
    url: url.toString(),
    fallbackUrl: unscoped.toString(),
    query: { query, derived_from: derived, location_id: scoped },
  };
}
