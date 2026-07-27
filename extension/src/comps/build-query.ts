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
 * Radius is NOT set. Payloads carry `"location":{"radius":65}`, but the query
 * parameter that sets it is unconfirmed, and the metro is the part that
 * matters. Progressive widening is step 3's fallback.
 */

import type { ObservationPayload } from "../shared/types";

const MARKETPLACE_ROOT = "https://www.facebook.com/marketplace";
const SEARCH_BASE = `${MARKETPLACE_ROOT}/search/`;

/** Place ids are numeric, but Facebook also accepts vanity slugs like "nyc". */
const LOCATION_ID_RE = /^[A-Za-z0-9.-]{3,64}$/;

export interface CompSearchQuery extends Record<string, unknown> {
  query: string;
  /** What the query was built from, so a bad comp set can be diagnosed later. */
  derived_from: { year: number | null; make: string | null; model: string | null };
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
export function buildCompSearch(
  target: ObservationPayload,
  locationId: string | null = null,
): CompSearch | null {
  const { year, make, model } = target;
  if (!model || !make) return null;

  const terms = [year !== null ? String(year) : null, make, model].filter(Boolean);
  const query = terms.join(" ");

  const unscoped = new URL(SEARCH_BASE);
  unscoped.searchParams.set("query", query);

  const scoped = LOCATION_ID_RE.test(locationId ?? "") ? locationId : null;
  if (scoped === null) {
    return {
      url: unscoped.toString(),
      fallbackUrl: null,
      query: { query, derived_from: { year, make, model }, location_id: null },
    };
  }

  const url = new URL(`${MARKETPLACE_ROOT}/${scoped}/search/`);
  url.searchParams.set("query", query);

  return {
    url: url.toString(),
    fallbackUrl: unscoped.toString(),
    query: { query, derived_from: { year, make, model }, location_id: scoped },
  };
}
