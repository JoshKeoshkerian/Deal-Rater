/**
 * Tiered comp widening across peer metros.
 *
 * Searches the listing's own metro first and adds peer markets one at a time,
 * stopping as soon as there are enough USABLE comps. Not raw results: a search
 * for a Porsche 924 returns fifteen rows of which one is a 924, and counting
 * those fifteen as success would stop widening exactly where it is needed most.
 *
 * WHY "USABLE" IS APPROXIMATED HERE
 * ---------------------------------
 * The authoritative comp filter is `app/pricing/comps.py`, which also dedupes
 * on content, drops parts listings and applies price sanity. That runs
 * server-side, after the capture is posted, so the extension cannot consult it
 * mid-search.
 *
 * `looksUsable` is a deliberately loose approximation of it -- same make, same
 * normalised model, year within the backend's widest window, a price present.
 * On captured data the backend keeps roughly 70-75% of what this counts, so the
 * approximation errs toward widening slightly less than strictly necessary.
 * That is the right direction: over-widening spends requests on markets the
 * comps did not need.
 *
 * REQUEST COUNT IS THE THING BEING ECONOMISED
 * -------------------------------------------
 * Every peer is one more HTTP request on a single user click. Spec 8.1 makes
 * user-initiated collection binding for Chrome Web Store distribution, and
 * draws the line at behaving like a user agent rather than a crawler. Stopping
 * the moment the target is met keeps the common case at one or two searches,
 * with the long tail reserved for the rare vehicles that genuinely need it.
 */

import { normalizeModel } from "../shared/parse";
import type { ObservationPayload } from "../shared/types";
import type { Metro } from "./metros";

/** Enough comps to stop widening. Matches the target the operator set. */
export const USABLE_COMP_TARGET = 30;

/**
 * Widest year window the backend will consider (`YEAR_WINDOW_LADDER` tops out
 * at 4). Counting a comp the backend would reject on year would overstate
 * progress and stop widening early.
 */
const MAX_YEAR_WINDOW = 4;

/** A loose stand-in for the backend's comp filter. See the module docstring. */
export function looksUsable(target: ObservationPayload, comp: ObservationPayload): boolean {
  if (comp.price_cents === null || comp.price_cents <= 0) return false;
  if (!comp.make || !comp.model || !target.make || !target.model) return false;
  if (comp.make.toLowerCase() !== target.make.toLowerCase()) return false;
  if (normalizeModel(comp.model) !== normalizeModel(target.model)) return false;
  if (target.year !== null && comp.year !== null) {
    if (Math.abs(comp.year - target.year) > MAX_YEAR_WINDOW) return false;
  }
  return true;
}

export function countUsable(
  target: ObservationPayload,
  comps: ObservationPayload[],
): number {
  return comps.reduce((n, comp) => n + (looksUsable(target, comp) ? 1 : 0), 0);
}

export interface MetroSearchOutcome {
  slug: string;
  /** Comps returned before deduplication against earlier metros. */
  returned: number;
  /**
   * False when the results did not come from the state this metro covers.
   *
   * Facebook answers an unrecognised location by silently returning the
   * account's own metro, so an unresolvable slug looks identical to an empty
   * market. The caller records these so a bad slug is dropped rather than
   * retried on every future capture.
   */
  resolved: boolean;
}

/** Peers still worth trying, with slugs already known bad removed. */
export function pendingPeers(peers: Metro[], knownBadSlugs: Iterable<string>): Metro[] {
  const bad = new Set(knownBadSlugs);
  return peers.filter((metro) => !bad.has(metro.slug));
}

/** Whether widening should continue after the metros searched so far. */
export function shouldWiden(
  target: ObservationPayload,
  comps: ObservationPayload[],
  remainingPeers: number,
  usableTarget = USABLE_COMP_TARGET,
): boolean {
  if (remainingPeers <= 0) return false;
  return countUsable(target, comps) < usableTarget;
}
