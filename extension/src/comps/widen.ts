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
 * Enough SAME-TRIM comps that the backend's fit can restrict itself to them
 * (`pricing/params.MIN_COMPS_FOR_SLOPE`; see `CompSet.preferred_fit_points`).
 * Below this the backend fits on the full mixed-trim set regardless of how
 * hard the extension looked, so there is nothing for widening past it to buy.
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
 * A loose, client-side stand-in for the backend's trim comparison
 * (`pricing/comps.trims_agree`), in the same spirit as `looksUsable`: not an
 * attempt at fidelity, just enough signal to decide whether widening for trim
 * is still worth a request.
 *
 * Token OVERLAP rather than the backend's exact set equality -- this only
 * gates an extra search, not a scoring decision, so "probably the same trim"
 * is the right bar, not "provably the same trim".
 *
 * THE MODEL NAME IS STRIPPED BEFORE COMPARING. Some listings repeat the model
 * inside the trim string ("CX-5 Touring"), and without stripping it, every
 * comp of the same model would share that token and register as trim-similar
 * regardless of their real trim -- the overlap check would stop meaning
 * anything for exactly the comps it exists to distinguish.
 *
 * KNOWN GAP, LEFT OPEN ON PURPOSE: this only strips what `model` actually
 * contains. Facebook's own structured data does not always agree with itself
 * about where the model ends and the trim begins -- a two-word model like
 * "Grand Cherokee" has shown up with model="Grand" and
 * trim_text="Cherokee Limited...", and stripping "grand" does not remove the
 * leaked "cherokee". Recovering the true model name for that case belongs to
 * the extraction pipeline that produced the split, not to a widening
 * heuristic with no way to know a better model name exists. The failure mode
 * here is benign either way: a false "similar" just means this widens less
 * than it ideally would for that specific vehicle, which is the same
 * shortfall widening already accepts everywhere else (see the module
 * docstring) -- it does not corrupt anything downstream, since this function
 * only ever gates an extra search.
 */
const TRIM_STOPWORDS = new Set(["4d", "4dr", "2d", "2dr", "awd", "fwd", "rwd", "4wd", "suv"]);

/** Same split as the trim text itself, so "CX-5" strips as {"cx","5"} on both
 * sides rather than leaving a bare "cx-5" that a hyphen-split trim token can
 * never equal. */
function splitTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function trimTokens(text: string | null, model: string | null): Set<string> {
  if (!text) return new Set();
  const modelWords = new Set(splitTokens(model ?? ""));
  return new Set(
    splitTokens(text).filter(
      (token) => !modelWords.has(token) && !TRIM_STOPWORDS.has(token) && !/^\d+$/.test(token),
    ),
  );
}

/** Whether a comp's trim looks like it could be the same as the target's. */
export function trimLooksSimilar(target: ObservationPayload, comp: ObservationPayload): boolean {
  const targetTokens = trimTokens(target.trim_text, target.model);
  if (targetTokens.size === 0) return false;
  const compTokens = trimTokens(comp.trim_text, comp.model);
  for (const token of compTokens) {
    if (targetTokens.has(token)) return true;
  }
  return false;
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
 * of it to restrict to, per `CompSet.preferred_fit_points`). The trim check
 * only runs once the target's own trim is known; when it is not, there is
 * nothing to widen FOR, and the usable-count check alone still applies.
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
  if (target.trim_text && countTrimMatched(target, comps) < trimTarget) return true;
  return false;
}
