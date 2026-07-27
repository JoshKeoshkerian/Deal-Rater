/**
 * Building the comp search (spec 4.3).
 *
 * One search, on the click, for the vehicle the user is already looking at.
 * Nothing here schedules, repeats, or broadens a search on its own — that is
 * the binding constraint in 8.1 and it is a property of the code, not a policy.
 *
 * The search is scoped to the *target listing's* coordinates, not the user's
 * Marketplace location. That was a real defect in the captured data and it is
 * silent: the comp set looks populated and is simply about a different market.
 *
 * Facebook's parameter names on this route are not stable, and a wrong one
 * returns zero results rather than erroring. Every call therefore carries a
 * `fallbackUrl` with the location parameters removed, and the caller retries
 * with it before concluding the market is empty — so an unrecognised parameter
 * costs one extra request instead of silently emptying the comp set. Confirm
 * the names against a live search page when one is to hand; they have not been
 * verified since the change.
 *
 * Year-range parameters are still omitted for the same unverified-name reason.
 * Progressive widening — radius first, then year range — is step 3's fallback.
 */

import type { ObservationPayload } from "../shared/types";

const SEARCH_BASE = "https://www.facebook.com/marketplace/search/";

export interface CompSearchQuery extends Record<string, unknown> {
  query: string;
  /** What the query was built from, so a bad comp set can be diagnosed later. */
  derived_from: { year: number | null; make: string | null; model: string | null };
  /**
   * The target's own coordinates, when the listing page carried them, plus the
   * radius asked for. Recorded whether or not the search honoured them, so that
   * a comp set drawn from the wrong metro is visible in the data rather than
   * having to be inferred from city names after the fact.
   */
  origin: { latitude: number; longitude: number; radius_km: number } | null;
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
 * Default search radius.
 *
 * Placeholder pending the section 0 comp-density numbers, which are not in the
 * repo yet. 65 miles is the widest of Facebook's own presets that still keeps
 * comps in one metro for the launch markets; step 3's fallback widens from here
 * when the comp count comes up short.
 */
export const DEFAULT_RADIUS_KM = 105;

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
  radiusKm: number = DEFAULT_RADIUS_KM,
): CompSearch | null {
  const { year, make, model, latitude, longitude } = target;
  if (!model || !make) return null;

  const terms = [year !== null ? String(year) : null, make, model].filter(Boolean);
  const query = terms.join(" ");

  const base = new URL(SEARCH_BASE);
  base.searchParams.set("query", query);
  const unscoped = base.toString();

  // Without these, the search runs against whatever metro the *user's* account
  // is set to, not the one the car is in. A Nashville listing evaluated by a
  // St. Louis user was benchmarked entirely against St. Louis comps 300 miles
  // away, which is a wrong expected price no amount of modelling recovers.
  const hasOrigin = latitude !== null && longitude !== null;
  if (hasOrigin) {
    base.searchParams.set("latitude", String(latitude));
    base.searchParams.set("longitude", String(longitude));
    base.searchParams.set("radius_km", String(radiusKm));
  }

  return {
    url: base.toString(),
    fallbackUrl: hasOrigin ? unscoped : null,
    query: {
      query,
      derived_from: { year, make, model },
      origin: hasOrigin
        ? { latitude: latitude!, longitude: longitude!, radius_km: radiusKm }
        : null,
    },
  };
}
