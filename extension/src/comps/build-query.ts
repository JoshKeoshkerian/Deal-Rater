/**
 * Building the comp search (spec 4.3).
 *
 * One search, on the click, for the vehicle the user is already looking at.
 * Nothing here schedules, repeats, or broadens a search on its own — that is
 * the binding constraint in 8.1 and it is a property of the code, not a policy.
 *
 * Only `query` is sent. Facebook does accept year-range and radius parameters
 * on this route, but their names are not stable enough to rely on unverified,
 * and a wrong parameter silently returns zero results rather than failing
 * loudly. Progressive widening — radius first, then year range — is step 3's
 * minimum-comp fallback, and that is the right place to introduce them, with a
 * result count to verify them against.
 */

import type { ObservationPayload } from "../shared/types";

const SEARCH_BASE = "https://www.facebook.com/marketplace/search/";

export interface CompSearchQuery extends Record<string, unknown> {
  query: string;
  /** What the query was built from, so a bad comp set can be diagnosed later. */
  derived_from: { year: number | null; make: string | null; model: string | null };
}

export interface CompSearch {
  url: string;
  query: CompSearchQuery;
}

/**
 * Build the search for a target listing.
 *
 * Returns null when there is not enough to search on. A search for "Toyota"
 * alone would return a comp set that looks populated and is meaningless, which
 * is worse for step 3 than returning nothing: the confidence model can react
 * to an empty comp set but not to a plausible wrong one.
 */
export function buildCompSearch(target: ObservationPayload): CompSearch | null {
  const { year, make, model } = target;
  if (!model || !make) return null;

  const terms = [year !== null ? String(year) : null, make, model].filter(Boolean);
  const query = terms.join(" ");

  const url = new URL(SEARCH_BASE);
  url.searchParams.set("query", query);

  return {
    url: url.toString(),
    query: { query, derived_from: { year, make, model } },
  };
}
