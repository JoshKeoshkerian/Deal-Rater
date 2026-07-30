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
import { trimLevelTokens, trimLevelsMatch } from "./trim-level";

/** Enough comps to stop widening. Matches the target the operator set. */
export const USABLE_COMP_TARGET = 30;

/**
 * Enough SAME-TRIM comps that the backend's fit can restrict itself to them
 * (`pricing/params.MIN_COMPS_FOR_SLOPE`; see `CompSet.preferred_fit_points`).
 * Below this the backend fits on the full mixed-trim set regardless of how
 * hard the extension looked, so there is nothing for widening past it to buy.
 *
 * 6 IS ALSO WHERE THE MEASURED HARM STOPS, which is the better reason to keep
 * it. `python -m app.cli.backtest --trim-bias` scores how far a target's own
 * trim sits from the average trim of the comps it was priced against, by how
 * many same-trim comps it had (117 unique target listings):
 *
 *     same-trim comps    median |trim-mix gap|
 *     0-2                       14.2%
 *     3-5                        5.5%
 *     6-8                        3.3%
 *     9-11                       3.4%
 *     12+                        2.5%
 *
 * The gap collapses by 6 and is flat past it, so widening further buys little.
 *
 * This target was previously unreachable in practice rather than merely
 * generous: `countTrimMatched` over-counted by 3.76x and satisfied it on 91% of
 * comp sets before widening could request anything. See `trim-level.ts`.
 */
export const TRIM_MATCH_TARGET = 6;

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

/**
 * Whether a comp is the same trim as the target, as far as the client can tell.
 *
 * Delegates to `trim-level.ts`, which mirrors the backend's notion of a trim
 * level -- body style, drivetrain and engine designator removed, compared as
 * token sets. That module's docstring records what this used to do instead and
 * what the difference measured, because the old version was not merely loose: it
 * counted 3.76x what the backend counts, agreed with it on only 61% of comps,
 * and reported the trim target as already met on 84% of comp sets where the
 * backend put it at 27%.
 *
 * Still an approximation, in the same spirit as `looksUsable` -- the backend
 * dedupes on content, drops parts listings and applies price sanity before any
 * of its comps are counted, and none of that runs here. But on the comps that do
 * survive, it now agrees with the backend on 98.6% of them and reaches the same
 * "6 comps or not" verdict on 98% of comp sets.
 */
export function trimLooksSimilar(target: ObservationPayload, comp: ObservationPayload): boolean {
  return trimLevelsMatch(
    trimLevelTokens(target.trim_text, target.model),
    trimLevelTokens(comp.trim_text, comp.model),
  );
}

export function countTrimMatched(
  target: ObservationPayload,
  comps: ObservationPayload[],
): number {
  return comps.reduce(
    (n, comp) => n + (looksUsable(target, comp) && trimLooksSimilar(target, comp) ? 1 : 0),
    0,
  );
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

/**
 * Whether widening should continue after the metros searched so far.
 *
 * Two independent reasons to keep going, either one sufficient on its own:
 * not enough usable comps yet, or -- once that is satisfied -- not enough of
 * them share the target's trim (spec 4.3: trim never EXCLUDES a comp, but a
 * fit restricted to matching trim is materially tighter when there is enough
 * of it to restrict to, per `CompSet.preferred_fit_points`).
 *
 * THE TRIM CHECK IS GATED ON A KNOWN TRIM LEVEL, not on `trim_text` being
 * populated, and the difference is load-bearing. 11% of stored targets carry a
 * `trim_text` that reduces to nothing but a body style -- "Sedan 4D",
 * "Coupe 2D" -- which the backend records as no trim at all. Gating on the raw
 * string would send every one of those chasing a target `countTrimMatched` can
 * never reach, spending the entire peer budget to find comps matching a trim
 * the listing never stated. When the trim is genuinely unknown there is nothing
 * to widen FOR, and the usable-count check alone still applies.
 */
export function shouldWiden(
  target: ObservationPayload,
  comps: ObservationPayload[],
  remainingPeers: number,
  usableTarget = USABLE_COMP_TARGET,
  trimTarget = TRIM_MATCH_TARGET,
): boolean {
  if (remainingPeers <= 0) return false;
  if (countUsable(target, comps) < usableTarget) return true;
  const trimKnown = trimLevelTokens(target.trim_text, target.model).size > 0;
  if (trimKnown && countTrimMatched(target, comps) < trimTarget) return true;
  return false;
}
